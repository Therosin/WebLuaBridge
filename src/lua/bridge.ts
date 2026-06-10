/**
 * Copyright (C) 2026 Theros <https://github.com/therosin>
 *
 * This file is part of WebLuaBridge.
 *
 * WebLuaBridge is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * WebLuaBridge is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with WebLuaBridge.  If not, see <https://www.gnu.org/licenses/>.
 */

import { LuaFactory } from 'npm:wasmoon@1.16.0';
import { COMMON_LUA_SOURCE } from '../common_lua_content.ts';

import type {
    LuaEngine,
    LuaGlobalHandle,
    LuaBridgeOptions,
    LuaRuntimeOptions,
    RuntimeStartOptions,
    LuaBridgeGlobals,
    LuaExecutionContext,
    LuaBridgeEventMap,
    LuaBridgeEventApi,
    EventHandler,
    BridgeEventsApi,
    LuaBindingFactory,
    BridgeState,
    RuntimeLoopState,
} from './types.ts';
import { BridgeEventBus } from './events.ts';
import {
    NOT_INITIALIZED_ERROR,
    UNKNOWN_ERROR,
    ENV_GLOBAL_NAME,
    INIT_FILE,
    DEFAULT_TICK_INTERVAL_MS,
    CALL_ON_INIT_CODE,
    CALL_UPDATE_CODE,
    CALL_ON_SHUTDOWN_CODE,
    COMPAT_ARGS_GLOBAL,
    DEFAULT_RUNTIME_OPTIONS,
    getErrorMessage,
    toBridgeError,
    isObject,
    toLuaLongString,
    normalizeRuntimeOptions,
    normalizeMainLoopInterval,
    luaWrap,
    unwrapTablePack,
    wrapForMultiReturn,
} from './utils.ts';
import { LuaBindings } from './bindings.ts';
import { LuaClass } from './lua_class.ts';

/**
 * Type-safe Lua runtime bridge backed by Wasmoon.
 *
 * Generic parameters:
 * - `TGlobals`: shape of injected globals for stronger key/value IntelliSense.
 * - `TEvents`: typed event payload map for `on/off/emit` helpers.
 */
class LuaBridge<
    TGlobals extends LuaBridgeGlobals = LuaBridgeGlobals,
    TEvents extends LuaBridgeEventMap = LuaBridgeEventMap,
> implements LuaBridgeEventApi<TEvents> {
    /** Wasmoon engine factory responsible for creating runtimes and mounting files. */
    private factory: LuaFactory;
    /** Cached global values reflected into Lua runtime on initialization. */
    private globals: TGlobals;
    /** Normalized runtime options passed to `factory.createEngine(...)`. */
    private runtimeOptions: LuaRuntimeOptions;
    /** Active runtime instance, if initialized. */
    private lua: LuaEngine | null;
    /** Current bridge lifecycle state. */
    private state: BridgeState;
    /** Internal bus used by JS and Lua-side `Events` API. */
    private eventBus: BridgeEventBus<TEvents>;
    /** Object injected into `_G.Events` for Lua code. */
    private eventsApi: BridgeEventsApi;
    /** Mounted file paths tracked for lifecycle startup logic. */
    private mountedFiles: Set<string>;
    /** Indicates whether lifecycle mode has been started. */
    private started: boolean;
    /** Mutable state used by JS main loop scheduling. */
    private mainLoop: RuntimeLoopState;
    /** Promise chain used as an async mutex for runtime operations. */
    private executionQueue: Promise<unknown>;
    /** Monotonic counter used to generate unique `_G` temporary keys. */
    private argsKeyCounter: number;
    /** Files to mount during init(). */
    private pendingFiles: Record<string, string>;
    /** Binding factories to install during init(). */
    private pendingBindings: LuaBindingFactory[];
    /** Stored original print function when print capture is active. */
    private originalPrint: unknown = null;

    /**
     * Create a new bridge instance.
     *
     * @param globals Globals injected into Lua `_G` during `init()`.
     * @param options Runtime and lifecycle options.
     */
    constructor(globals: TGlobals = {} as TGlobals, options: LuaBridgeOptions = {}) {
        const { mainLoopIntervalMs, wasmUri, files, bindings, ...runtimeOptions } = options;

        this.factory = wasmUri ? new LuaFactory(wasmUri) : new LuaFactory();
        this.globals = globals;
        this.runtimeOptions = normalizeRuntimeOptions(runtimeOptions);
        this.lua = null;
        this.state = 'new';
        this.eventBus = new BridgeEventBus<TEvents>();
        this.eventsApi = this.createEventsApi();
        this.mountedFiles = new Set();
        this.pendingFiles = files || {};
        this.pendingBindings = bindings || [];
        this.started = false;
        this.mainLoop = {
            active: false,
            timer: null,
            intervalMs: normalizeMainLoopInterval(mainLoopIntervalMs),
            lastTickAt: 0,
            runningTick: false,
        };
        this.executionQueue = Promise.resolve();
        this.argsKeyCounter = 0;
    }

    /** Throw when runtime-dependent methods are used before initialization. */
    private assertInitialized(): void {
        if (!this.lua) {
            throw new Error(NOT_INITIALIZED_ERROR);
        }
    }

    /** Return active Lua runtime (throws if missing). */
    private getLua(): LuaEngine {
        this.assertInitialized();
        return this.lua as LuaEngine;
    }

    /**
     * Serialize runtime operations through a single promise queue.
     *
     * Public to preserve current test hooks and advanced integration scenarios.
     */
    async withExecutionLock<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.executionQueue.then(operation);
        this.executionQueue = run.catch(() => undefined);
        return await run;
    }

    /** Generate a unique key for temporary globals. */
    private nextArgsKey(): string {
        this.argsKeyCounter += 1;
        return `__lua_bridge_args_${this.argsKeyCounter}`;
    }

    /**
     * Set compatibility `args` global only for duration of a file execution.
     *
     * This supports legacy scripts that read `_G.args` instead of varargs.
     */
    private async withScopedCompatArgs<T>(args: unknown[], operation: () => Promise<T>): Promise<T> {
        if (!args || args.length === 0) {
            return await operation();
        }

        const lua = this.getLua();
        const previousArgs = lua.global.get(COMPAT_ARGS_GLOBAL);
        lua.global.set(COMPAT_ARGS_GLOBAL, args);
        try {
            return await operation();
        } finally {
            lua.global.set(COMPAT_ARGS_GLOBAL, previousArgs);
        }
    }

    /**
     * Initialize runtime and inject bridge APIs.
     *
     * Safe to call multiple times.
     */
    async init(): Promise<void> {
        if (this.state === 'initialized') {
            return;
        }

        try {
            this.lua = (await this.factory.createEngine(this.runtimeOptions)) as unknown as LuaEngine;
            this.lua.global.set('Events', this.eventsApi);

            for (const [name, value] of Object.entries(this.globals)) {
                if (value instanceof LuaClass) {
                    value.installSync(this.lua, name);
                } else {
                    this.lua.global.set(name, value);
                }
            }

            // Mount any pre-configured files
            if (this.pendingFiles) {
                for (const [path, content] of Object.entries(this.pendingFiles)) {
                    await this.factory.mountFile(path, content);
                    this.mountedFiles.add(path);
                }
                this.pendingFiles = {};
            }

            this.state = 'initialized';

            // Process bindings
            if (this.pendingBindings.length > 0) {
                for (const factory of this.pendingBindings) {
                    const binding = factory({ bridge: this });
                    if (binding instanceof LuaBindings) {
                        await binding.install(this.lua);
                    }
                }
                this.pendingBindings = [];
            }
        } catch (error) {
            throw toBridgeError('Failed to initialize LuaBridge', error);
        }
    }

    /**
     * Stop loop state and close runtime resources.
     *
     * Safe to call even when runtime is not initialized.
     */
    close(): void {
        this.stopMainLoop();
        if (!this.lua) {
            this.state = 'closed';
            this.started = false;
            return;
        }

        try {
            this.lua.global.close();
            this.lua = null;
            this.state = 'closed';
            this.started = false;
        } catch (error) {
            throw toBridgeError('Failed to close LuaBridge', error);
        }
    }

    /** Queue the next update tick while loop mode is active. */
    private scheduleMainLoopTick(): void {
        if (!this.mainLoop.active) {
            return;
        }

        this.mainLoop.timer = setTimeout(async () => {
            if (!this.mainLoop.active) {
                return;
            }

            const now = Date.now();
            const dtMs = this.mainLoop.lastTickAt > 0
                ? now - this.mainLoop.lastTickAt
                : this.mainLoop.intervalMs;
            this.mainLoop.lastTickAt = now;

            if (this.mainLoop.runningTick) {
                this.scheduleMainLoopTick();
                return;
            }

            this.mainLoop.runningTick = true;
            try {
                await this.execute(CALL_UPDATE_CODE, dtMs / 1000);
            } catch (error) {
                this.emit('mainloop:error', error);
            } finally {
                this.mainLoop.runningTick = false;
            }

            this.scheduleMainLoopTick();
        }, this.mainLoop.intervalMs);
    }

    /**
     * Start the JS-driven main loop.
     *
     * @param intervalMs Milliseconds between update ticks.
     * @returns `true` if loop started; `false` if already active.
     */
    startMainLoop(intervalMs = this.mainLoop.intervalMs): boolean {
        this.getLua();
        if (this.mainLoop.active) {
            return false;
        }

        if (typeof intervalMs !== 'number' || intervalMs <= 0) {
            throw new Error('Main loop interval must be a positive number');
        }

        this.mainLoop.active = true;
        this.mainLoop.intervalMs = intervalMs;
        this.mainLoop.lastTickAt = Date.now();
        this.mainLoop.runningTick = false;
        this.scheduleMainLoopTick();
        return true;
    }

    /**
     * Stop the JS-driven main loop.
     *
     * @returns `true` if loop was active before stop.
     */
    stopMainLoop(): boolean {
        const wasActive = this.mainLoop.active;
        this.mainLoop.active = false;
        this.mainLoop.runningTick = false;
        this.mainLoop.lastTickAt = 0;
        if (this.mainLoop.timer) {
            clearTimeout(this.mainLoop.timer);
            this.mainLoop.timer = null;
        }
        return wasActive;
    }

    /**
     * Start lifecycle mode.
     *
     * Flow:
     * 1. Initialize runtime
     * 2. Execute mounted `init.lua` (if present)
     * 3. Call `_G.OnInit(...)` (if present)
     * 4. Start update loop calling `_G.Update(dt)`
     */
    async start(options: RuntimeStartOptions = {}): Promise<void> {
        const { intervalMs = this.mainLoop.intervalMs } = options;
        if (this.started) {
            return;
        }

        await this.init();

        try {
            if (this.mountedFiles.has(INIT_FILE)) {
                await this.executeFile(INIT_FILE);
            }
            await this.execute(CALL_ON_INIT_CODE);
            this.startMainLoop(intervalMs);
            this.started = true;
        } catch (error) {
            throw toBridgeError('Failed to start LuaBridge', error);
        }
    }

    /**
     * Shutdown lifecycle mode and close runtime.
     *
     * Flow:
     * 1. Stop update loop
     * 2. Call `_G.OnShutdown(...)` (if present)
     * 3. Close runtime
     */
    async shutdown(): Promise<void> {
        this.stopMainLoop();
        this.started = false;

        if (!this.lua) {
            this.state = 'closed';
            return;
        }

        try {
            await this.execute(CALL_ON_SHUTDOWN_CODE);
        } catch (error) {
            throw toBridgeError('Failed to shutdown LuaBridge', error);
        } finally {
            this.close();
        }
    }

    /** Remove Lua implicit `self` argument when methods are called with `:` syntax. */
    private normalizeLuaMethodArgs(args: unknown[]): unknown[] {
        if (args.length > 0 && args[0] === this.eventsApi) {
            return args.slice(1);
        }
        if (args.length > 1 && typeof args[0] !== 'string' && typeof args[1] === 'string') {
            return args.slice(1);
        }
        return args;
    }

    /** Parse `event` and `handler` from Lua/JS argument lists. */
    private extractEventAndHandler(args: unknown[]): [string, EventHandler] {
        const normalized = this.normalizeLuaMethodArgs(args);
        const [event, handler] = normalized;
        if (typeof event !== 'string' || event.length === 0) {
            throw new Error('Event name must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('Event handler must be a function');
        }
        return [event, handler as EventHandler];
    }

    /** Build the Lua-facing `Events` API object. */
    private createEventsApi(): BridgeEventsApi {
        return {
            On: (...args: unknown[]) => {
                const [event, handler] = this.extractEventAndHandler(args);
                return this.eventBus.on(event, handler);
            },
            Off: (...args: unknown[]) => {
                const [event, handler] = this.extractEventAndHandler(args);
                return this.eventBus.off(event, handler);
            },
            Emit: (...args: unknown[]) => {
                const normalized = this.normalizeLuaMethodArgs(args);
                const [event, ...payload] = normalized;
                if (typeof event !== 'string' || event.length === 0) {
                    throw new Error('Event name must be a non-empty string');
                }
                return this.eventBus.emit(event, ...payload);
            },
        };
    }

    /** Register listener for a strongly typed event key. */
    on<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): () => boolean;
    /** Register listener for dynamic/untyped event keys. */
    on(event: string, handler: EventHandler): () => boolean;
    on(event: string, handler: (...args: any[]) => void): () => boolean {
        return this.eventBus.on(event, handler);
    }

    /** Unregister listener for a strongly typed event key. */
    off<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): boolean;
    /** Unregister listener for dynamic/untyped event keys. */
    off(event: string, handler: EventHandler): boolean;
    off(event: string, handler: (...args: any[]) => void): boolean {
        return this.eventBus.off(event, handler);
    }

    /** Emit a strongly typed event payload. */
    emit<K extends keyof TEvents & string>(event: K, ...args: TEvents[K]): number;
    /** Emit a dynamic/untyped event payload. */
    emit(event: string, ...args: unknown[]): number;
    emit(event: string, ...args: unknown[]): number {
        return this.eventBus.emit(event, ...args);
    }

    /**
     * Check if the bridge is currently in lifecycle mode (started).
     */
    isStarted(): boolean {
        return this.started;
    }

    /**
     * Check if the main update loop is active.
     */
    isMainLoopActive(): boolean {
        return this.mainLoop.active;
    }

    /**
     * Reset a closed bridge so it can be re-initialized.
     *
     * This clears the closed state and allows `init()` or `start()` to be called again.
     * All previously mounted files and event listeners are preserved.
     *
     * @returns `true` if reset was performed, `false` if bridge was not in closed state.
     */
    reset(): boolean {
        if (this.state !== 'closed') {
            return false;
        }
        this.state = 'new';
        return true;
    }

    /**
     * Set multiple globals at once.
     *
     * @param values A map of global names to values.
     */
    setGlobals(values: Record<string, unknown>): void {
        for (const [name, value] of Object.entries(values)) {
            this.setGlobal(name, value);
        }
    }

    /**
     * Set global in both local cache and active Lua runtime.
     *
     * Strongly typed for known keys in `TGlobals`.
     */
    setGlobal<K extends keyof TGlobals & string>(name: K, value: TGlobals[K]): void;
    /** Set global by dynamic key when shape is not known at compile time. */
    setGlobal(name: string, value: unknown): void;
    setGlobal(name: string, value: unknown): void {
        if (value instanceof LuaClass) {
            value.installSync(this.getLua(), name);
            this.globals[name as keyof TGlobals] = value as TGlobals[keyof TGlobals];
            return;
        }
        try {
            const lua = this.getLua();
            this.globals[name as keyof TGlobals] = value as TGlobals[keyof TGlobals];
            lua.global.set(name, value);
        } catch (error) {
            throw toBridgeError('Failed to set global', error);
        }
    }

    /**
     * Read global value from active Lua runtime.
     *
     * Prefer keyed overload when global shape is known.
     */
    getGlobal<K extends keyof TGlobals & string>(name: K): TGlobals[K];
    /** Read global value by dynamic key and optional generic type. */
    getGlobal<T = unknown>(name: string): T;
    getGlobal<T = unknown>(name: string): T {
        try {
            return this.getLua().global.get<T>(name);
        } catch (error) {
            throw toBridgeError('Failed to get global', error);
        }
    }

    /**
     * Read a deeply nested global value using a dot-delimited path.
     *
     * Unlike `getGlobal`, this traverses into tables. Returns the default
     * value when any intermediate path segment is missing.
     *
     * @example
     * ```ts
     * await bridge.execute('config = { debug = true, limits = { max = 100 } }');
     * const max = await bridge.Get('config.limits.max');     // 100
     * const dbg = await bridge.Get('config.debug', false);     // true
     * const missing = await bridge.Get('config.foo', 'fallback'); // 'fallback'
     * ```
     */
    async Get<T = unknown>(path: string, defaultValue?: T): Promise<T | undefined> {
        this.getLua();
        const safePath = toLuaLongString(path);
        return await this.withExecutionLock(async () => {
            return await this.executeInCurrentLock<T | undefined>(
                `
                    local val = _G
                    for part in string.gmatch(${safePath}, "[^.]+") do
                        val = val[part]
                        if val == nil then
                            return ...
                        end
                    end
                    return val
                `,
                defaultValue,
            );
        });
    }

    /**
     * Write a deeply nested global value using a dot-delimited path.
     *
     * Unlike `setGlobal`, this traverses into tables and creates intermediate
     * tables when they don't exist.
     *
     * @example
     * ```ts
     * await bridge.Set('config.limits.max', 200);
     * // equivalent to: _G.config = _G.config or {}; config.limits = config.limits or {}; config.limits.max = 200
     * ```
     */
    async Set(path: string, value: unknown): Promise<void> {
        this.getLua();
        return await this.withExecutionLock(async () => {
            try {
                const safePath = toLuaLongString(path);
                await this.executeInCurrentLock(
                    `
                        local parts = {}
                        for part in string.gmatch(${safePath}, "[^.]+") do
                            parts[#parts + 1] = part
                        end
                        if #parts == 0 then error("empty path") end
                        local obj = _G
                        for i = 1, #parts - 1 do
                            if obj[parts[i]] == nil then
                                obj[parts[i]] = {}
                            end
                            obj = obj[parts[i]]
                        end
                        obj[parts[#parts]] = ...
                    `,
                    value,
                );
            } catch (error) {
                throw toBridgeError(`Failed to set path '${path}'`, error);
            }
        });
    }

    /** Set a field on a global Lua table. */
    setField(tableName: string, field: string, value: unknown): void {
        try {
            const lua = this.getLua();
            lua.global.getTable(tableName, (index: number) => {
                lua.global.setField(index, field, value);
            });
        } catch (error) {
            throw toBridgeError('Failed to set field', error);
        }
    }

    /**
     * Load the `common.lua` utility library as the `"common"` module.
     *
     * After calling this, Lua code can `require("common")` to access:
     * - `Detour(path, def)` — hook/intercept any global function with pre/post callbacks
     * - `OnlyRunOnce(fn, allowReset?)` — wrap a function to run exactly once
     * - `ReadOnly(table)` — create a read-only proxy for a table
     * - `Class(name, static?)` — simple OOP class builder
     * - `pack(...)` / `unpackn(t)` — tuple-to-table utilities
     *
     * @param injectGlobals If true, also injects `Detour`, `OnlyRunOnce`, `ReadOnly`, and `Class` into `_G`.
     */
    async loadCommon(injectGlobals: boolean = false): Promise<void> {
        await this.loadModule('common', COMMON_LUA_SOURCE);
        if (injectGlobals) {
            const lua = this.getLua();
            await this.execute(`
                local _common = require("common")
                Detour = _common.Detour
                OnlyRunOnce = _common.OnlyRunOnce
                ReadOnly = _common.ReadOnly
                Class = _common.Class
            `);
        }
    }

    /**
     * Capture or release Lua `print()` output.
     *
     * When a callback is provided, Lua's `print()` is redirected to call the
     * callback with all arguments (joined with tab like Lua's default formatter).
     * Pass `null` to restore the original `print`.
     *
     * @example
     * ```ts
     * const logs: string[] = [];
     * bridge.onPrint((msg) => logs.push(msg));
     * await bridge.execute('print("hello", "world")');
     * console.log(logs); // ['hello\\tworld']
     * ```
     */
    onPrint(callback: ((message: string) => void) | null): void {
        const lua = this.getLua();
        if (callback) {
            // Store original and override
            if (this.originalPrint === null) {
                this.originalPrint = lua.global.get('print');
            }
            // Wrap in a Lua-compatible function that formats like Lua's print
            lua.global.set('print', (...args: unknown[]) => {
                const formatted = args.map((a) => String(a)).join('\t');
                callback(formatted);
            });
        } else {
            // Restore original
            if (this.originalPrint !== null) {
                lua.global.set('print', this.originalPrint);
                this.originalPrint = null;
            }
        }
    }

    /**
     * Get current Lua memory usage in bytes.
     * Requires `traceAllocations: true` in runtime options for accurate tracking.
     *
     * @returns Memory used in bytes, or 0 if not available.
     */
    getMemoryUsed(): number {
        try {
            return this.getLua().global.getMemoryUsed();
        } catch (error) {
            throw toBridgeError('Failed to get memory usage', error);
        }
    }

    /**
     * Get the current Lua memory cap (max allocatable bytes).
     *
     * @returns Maximum memory in bytes, or `undefined` if no limit is set.
     */
    getMemoryMax(): number | undefined {
        try {
            return this.getLua().global.getMemoryMax();
        } catch (error) {
            throw toBridgeError('Failed to get memory max', error);
        }
    }

    /**
     * Set a hard memory cap for the Lua runtime.
     *
     * When the limit is exceeded, allocations will fail with an out-of-memory error.
     *
     * @param max Maximum memory in bytes, or `undefined` to remove the limit.
     */
    setMemoryMax(max: number | undefined): void {
        try {
            this.getLua().global.setMemoryMax(max);
        } catch (error) {
            throw toBridgeError('Failed to set memory max', error);
        }
    }

    /**
     * Dump the current Lua stack to the console (or custom logger) for debugging.
     *
     * @param log Optional logger function (defaults to `console.log`).
     */
    dumpStack(log?: (...data: unknown[]) => void): void {
        try {
            this.getLua().global.dumpStack(log);
        } catch (error) {
            throw toBridgeError('Failed to dump stack', error);
        }
    }

    /**
     * Call a Lua global function directly from JS.
     *
     * Avoids string-wrapping: no `execute("return fn(...)")` gymnastics.
     * Returns the first return value, or `LuaMultiReturn` for multiple values.
     *
     * @example
     * ```ts
     * await bridge.execute(`
     *   function add(a, b) return a + b end
     *   function stats() return 1, 2, 3 end
     * `);
     * const sum = await bridge.call('add', 20, 22); // 42
     * const [a, b, c] = await bridge.call('stats'); // LuaMultiReturn
     * ```
     */
    async call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
        const lua = this.getLua();
        return await this.withExecutionLock(async () => {
            try {
                if (typeof name !== 'string' || name.length === 0) {
                    throw new Error('Function name must be a non-empty string');
                }
                const result = lua.global.call(name, ...args);
                if (result && result.length > 0) {
                    return (result.length === 1 ? result[0] : result) as T;
                }
                return undefined as unknown as T;
            } catch (error) {
                throw toBridgeError(`Failed to call '${name}'`, error);
            }
        });
    }

    /**
     * Load a module directly into `package.loaded[moduleName]`.
     *
     * @param name Module key used by `require(name)`.
     * @param code Lua module body code.
     */
    async loadModule(name: string, code: string): Promise<void> {
        const lua = this.getLua();
        return await this.withExecutionLock(async () => {
            try {
                if (typeof name !== 'string' || name.length === 0) {
                    throw new Error('Module name must be a non-empty string');
                }
                if (typeof code !== 'string') {
                    throw new Error('Module code must be a string');
                }

                const moduleNameKey = `__lua_bridge_module_name_${this.nextArgsKey()}`;
                lua.global.set(moduleNameKey, name);
                try {
                    await lua.doString(`
                        local __module_name = _G['${moduleNameKey}']
                        _G['${moduleNameKey}'] = nil
                        package.loaded[__module_name] = (function(...) ${code} end)()
                    `);
                } finally {
                    lua.global.set(moduleNameKey, undefined);
                }
            } catch (error) {
                throw toBridgeError('Failed to load module', error);
            }
        });
    }

    /** Execute Lua source string in the current runtime. */
    async execute<T = unknown>(code: string, ...args: unknown[]): Promise<T> {
        this.getLua();
        return await this.withExecutionLock(async () => {
            return await this.executeInCurrentLock<T>(code, ...args);
        });
    }

    /** Execute a mounted Lua file in the current runtime. */
    async executeFile<T = unknown>(file: string, ...args: unknown[]): Promise<T> {
        const lua = this.getLua();
        return await this.withExecutionLock(async () => {
            try {
                return await this.withScopedCompatArgs(args, async () => {
                    const wrapped = wrapForMultiReturn(`return dofile(${toLuaLongString(file)})`);
                    const raw = await lua.doString<Record<string, unknown>>(wrapped);
                    return unwrapTablePack(raw) as unknown as T;
                });
            } catch (error) {
                throw toBridgeError('Failed to execute file', error);
            }
        });
    }

    /**
     * Execute Lua source synchronously. Useful in contexts where async is inconvenient.
     *
     * Note: This bypasses the execution lock. Use with care in single-threaded contexts.
     */
    executeSync<T = unknown>(code: string): T {
        try {
            return this.getLua().doStringSync<T>(code);
        } catch (error) {
            throw toBridgeError('Failed to execute sync', error);
        }
    }

    /**
     * Execute a mounted Lua file synchronously.
     *
     * Note: This bypasses the execution lock. Use with care in single-threaded contexts.
     */
    executeFileSync<T = unknown>(file: string): T {
        try {
            return this.getLua().doFileSync<T>(file);
        } catch (error) {
            throw toBridgeError('Failed to execute file sync', error);
        }
    }

    /**
     * Build a scoped execution proxy backed by a custom environment object.
     *
     * Reads resolve from `env` first, then `_G`; writes always target `env`.
     *
     * @param env The environment object backing the scope.
     * @param options Optional configuration for the scoped context.
     * @param options.files Files to mount into the Lua filesystem before any scoped execution.
     */
    async useEnvironment<TEnv extends Record<string, unknown>>(
        env: TEnv,
        options?: { files?: Record<string, string> },
    ): Promise<LuaExecutionContext<TEnv>> {
        const lua = this.getLua();
        try {
            if (!isObject(env)) {
                throw new Error('Environment must be an object');
            }

            // Mount environment-scoped files
            if (options?.files) {
                for (const [path, content] of Object.entries(options.files)) {
                    await this.factory.mountFile(path, content);
                    this.mountedFiles.add(path);
                }
            }

            const withEnvironment = async <T>(callback: () => Promise<T>): Promise<T> => {
                return await this.withExecutionLock(async () => {
                    lua.global.set(ENV_GLOBAL_NAME, env);
                    try {
                        return await callback();
                    } finally {
                        lua.global.set(ENV_GLOBAL_NAME, undefined);
                    }
                });
            };

            const scopeCodePrefix = `
local __bridge_env = ${ENV_GLOBAL_NAME}
local __scope = setmetatable({}, {
    __index = function(_, key)
        local value = __bridge_env[key]
        if value ~= nil then
            return value
        end
        return _G[key]
    end,
    __newindex = function(_, key, value)
        __bridge_env[key] = value
    end,
})
`;

            return {
                environment: env,

                execute: async <T = unknown>(code: string, ...args: unknown[]): Promise<T> => {
                    const wrappedCode = `${scopeCodePrefix}
local __chunk = assert(load(${toLuaLongString(code)}, nil, 't', __scope))
return __chunk(...)
`;
                    return await withEnvironment(() => this.executeInCurrentLock<T>(wrappedCode, ...args));
                },

                executeFile: async <T = unknown>(file: string, ...args: unknown[]): Promise<T> => {
                    const wrappedCode = `${scopeCodePrefix}
local __chunk = assert(loadfile(${toLuaLongString(file)}, 't', __scope))
return __chunk(...)
`;
                    return await withEnvironment(() => this.executeInCurrentLock<T>(wrappedCode, ...args));
                },

                mountFile: async (path: string, content: string): Promise<void> => {
                    this.assertInitialized();
                    await this.factory.mountFile(path, content);
                    this.mountedFiles.add(path);
                },

                // ── Environment introspection & manipulation ──

                get: <T = unknown>(key: string): T => (env as Record<string, unknown>)[key] as T,
                set: (key: string, value: unknown): void => { (env as Record<string, unknown>)[key] = value; },
                has: (key: string): boolean => key in env,
                delete: (key: string): boolean => {
                    const existed = key in env;
                    delete (env as Record<string, unknown>)[key];
                    return existed;
                },
                keys: (): string[] => Object.keys(env),
                assign: (pairs: Record<string, unknown>): void => {
                    Object.assign(env, pairs);
                },
                clear: (): void => {
                    for (const key of Object.keys(env)) {
                        delete (env as Record<string, unknown>)[key];
                    }
                },

                // ── Convenience execution helpers ──

                eval: async <T = unknown>(expression: string): Promise<T> => {
                    // Reuses execute() which provides scope prefix, withEnvironment, and multi-return handling
                    return await this.execute<T>(`return (${expression})`);
                },

                call: async <T = unknown>(name: string, ...args: unknown[]): Promise<T> => {
                    // Reuses execute() — name is a Lua identifier or dotted path
                    // resolved through the scope's __index (env vars → _G)
                    return await this.execute<T>(
                        `local __fn = ${name}
if type(__fn) ~= "function" then
    error("attempt to call a non-function value ('" .. "${name}" .. "')", 0)
end
return __fn(...)`,
                        ...args,
                    );
                },
            };
        } catch (error) {
            throw toBridgeError('Failed to use environment', error);
        }
    }

    /** Execute code while already holding the execution lock. */
    private async executeInCurrentLock<T = unknown>(code: string, ...args: unknown[]): Promise<T> {
        try {
            const lua = this.getLua();
            let finalCode: string;

            if (args.length > 0) {
                const argsGlobalName = this.nextArgsKey();
                lua.global.set(argsGlobalName, args);
                try {
                    finalCode = luaWrap(code, argsGlobalName);
                    const raw = await lua.doString<Record<string, unknown>>(finalCode);
                    return unwrapTablePack(raw) as unknown as T;
                } finally {
                    lua.global.set(argsGlobalName, undefined);
                }
            }

            finalCode = wrapForMultiReturn(code);
            const raw = await lua.doString<Record<string, unknown>>(finalCode);
            return unwrapTablePack(raw) as unknown as T;
        } catch (error) {
            throw toBridgeError('Failed to execute code', error);
        }
    }

    /**
     * Mount a file into Wasmoon's in-memory Lua filesystem.
     *
     * Mounted files can be run via `executeFile(...)` or required from Lua.
     */
    async mountFile(file: string, content: string): Promise<void> {
        this.assertInitialized();
        try {
            await this.factory.mountFile(file, content);
            this.mountedFiles.add(file);
        } catch (error) {
            throw toBridgeError('Failed to mount file', error);
        }
    }
}

export default LuaBridge;

/**
 * Create and initialize a new `LuaBridge`.
 *
 * @typeParam TGlobals Known global map used for typed `setGlobal/getGlobal` keys.
 * @typeParam TEvents Event payload map used for typed `on/off/emit`.
 */
export async function createLuaBridge<
    TGlobals extends LuaBridgeGlobals = LuaBridgeGlobals,
    TEvents extends LuaBridgeEventMap = LuaBridgeEventMap,
>(
    globals: TGlobals = {} as TGlobals,
    options: LuaBridgeOptions = {},
): Promise<LuaBridge<TGlobals, TEvents>> {
    const lua = new LuaBridge<TGlobals, TEvents>(globals, options);
    await lua.init();
    return lua;
}

/**
 * Execute Lua source in a temporary isolated bridge instance.
 *
 * The runtime is always closed before the promise resolves/rejects.
 */
export async function runLuaCode<T = unknown>(code: string, ...args: unknown[]): Promise<T> {
    const lua = await createLuaBridge();
    try {
        const result = await lua.execute<T>(code, ...args);
        lua.close();
        return result;
    } catch (error) {
        lua.close();
        throw error;
    }
}

export { LuaClass } from './lua_class.ts';
export { LuaBindings } from './bindings.ts';
