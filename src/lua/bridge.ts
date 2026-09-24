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

// reason: inline npm specifier keeps wasmoon resolvable by consumer bundlers
// (esbuild) that do not inherit this repo's import map.
// deno-lint-ignore no-import-prefix
import { LuaFactory } from 'npm:wasmoon@1.16.0';

import type {
    LuaEngine,
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
    INIT_FILE,
    CALL_ON_INIT_CODE,
    CALL_UPDATE_CODE,
    CALL_ON_SHUTDOWN_CODE,
    toBridgeError,
    normalizeRuntimeOptions,
    normalizeMainLoopInterval,
} from './utils.ts';
import { LuaBindings } from './bindings.ts';
import { LuaClass } from './lua_class.ts';
import { BridgeError, ErrorCodes } from './errors.ts';
import { VfsRegistry } from './vfs.ts';
import { ExecutionService } from './execution.ts';
import { EnvironmentService } from './environment.ts';

/**
 * Type-safe Lua runtime bridge backed by Wasmoon.
 *
 * Generic parameters:
 * - `TGlobals`: shape of injected globals for stronger key/value IntelliSense.
 * - `TEvents`: typed event payload map for `on/off/emit` helpers.
 */
export class LuaBridge<
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
    /** Indicates whether lifecycle mode has been started. */
    private started: boolean;
    /** Mutable state used by JS main loop scheduling. */
    private mainLoop: RuntimeLoopState;
    /** Promise chain used as an async mutex for runtime operations. */
    private executionQueue: Promise<unknown>;
    /** Reentrancy guard — set while a lock-holder is actively executing. */
    private inLock = false;
    /** Monotonic counter used to generate unique `_G` temporary keys. */
    private argsKeyCounter: number;
    /** Binding factories to install during init(). */
    private pendingBindings: LuaBindingFactory[];
    /** Active binding instances (for cleanup on close). */
    private activeBindings: LuaBindings[];
    /** Stored original print function when print capture is active (shared mutable ref). */
    private originalPrintRef: { current: unknown } = { current: null };

    /** Composed VfsRegistry managing pending/mounted file lifecycle. */
    private vfs: VfsRegistry;
    /** Composed ExecutionService for Lua execution and globals. */
    private executionService!: ExecutionService;
    /** Composed EnvironmentService for scoped execution contexts. */
    private environmentService!: EnvironmentService;

    /**
     * Create a new bridge instance.
     *
     * @param globals Globals injected into Lua `_G` during `init()`.
     * @param options Runtime and lifecycle options.
     */
    constructor(globals: TGlobals = {} as TGlobals, options: LuaBridgeOptions = {}) {
        const { mainLoopIntervalMs, wasmUri, files, bindings, ...runtimeOptions } = options;

        this.factory = wasmUri ? new LuaFactory(wasmUri) : new LuaFactory();
        this.vfs = new VfsRegistry(this.factory);
        this.globals = globals;
        this.runtimeOptions = normalizeRuntimeOptions(runtimeOptions);
        this.lua = null;
        this.state = 'new';
        this.eventBus = new BridgeEventBus<TEvents>();
        this.eventsApi = this.createEventsApi();
        this.pendingBindings = bindings || [];
        this.activeBindings = [];
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

        // Register pending files via VfsRegistry instead of raw record
        if (files) {
            for (const [path, content] of Object.entries(files)) {
                this.vfs.addPending(path, content);
            }
        }
    }

    /** Throw when runtime-dependent methods are used before initialization. */
    private assertInitialized(): void {
        if (!this.lua) {
            throw new BridgeError(NOT_INITIALIZED_ERROR, ErrorCodes.NOT_INITIALIZED);
        }
    }

    /** Return active Lua runtime (throws if missing). */
    private getLua(): LuaEngine {
        this.assertInitialized();
        return this.lua as LuaEngine;
    }

    /** Throw a MEMORY error when Lua heap is near the cap. */
    private checkMemoryLimit(): void {
        let max: number | undefined;
        try {
            max = this.executionService.getMemoryMax();
        } catch {
            return; // tracing disabled — skip check
        }
        if (max === undefined) return; // no cap set
        const used = this.executionService.getMemoryUsed();
        const ratio = used / max;
        if (ratio > 0.9) {
            throw new BridgeError(
                `Lua memory usage (${Math.round(ratio * 100)}%) exceeds 90% cap — refusing to execute`,
                ErrorCodes.MEMORY,
            );
        }
    }

    /**
     * Advanced: execute an operation under the bridge's serial execution lock.
     *
     * When an `AbortSignal` is provided, the operation will be rejected
     * with `CANCELLED` if the signal is already aborted or becomes
     * aborted while waiting in the queue. Once the operation starts
     * executing, the signal is ignored.
     *
     * Accepts an optional AbortSignal to cancel before execution starts.
     */
    async withExecutionLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) {
            throw new BridgeError('Operation cancelled', ErrorCodes.CANCELLED);
        }
        this.checkMemoryLimit();

        // Reentrant: already holding the lock — run directly without queueing
        if (this.inLock) {
            return await operation();
        }

        const run = this.executionQueue.then(async () => {
            if (signal?.aborted) {
                throw new BridgeError('Operation cancelled', ErrorCodes.CANCELLED);
            }
            this.inLock = true;
            try {
                return await operation();
            } finally {
                this.inLock = false;
            }
        });

        this.executionQueue = run.catch(() => undefined);
        return await run;
    }

    /** Generate a unique key for temporary globals. */
    private nextArgsKey(): string {
        this.argsKeyCounter += 1;
        return `__lua_bridge_args_${this.argsKeyCounter}`;
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

            // Create composed services after engine is available
            this.executionService = new ExecutionService({
                getLua: () => this.getLua(),
                withExecutionLock: <T>(op: () => Promise<T>) => this.withExecutionLock(op),
                nextArgsKey: () => this.nextArgsKey(),
                originalPrint: this.originalPrintRef,
            });

            this.environmentService = new EnvironmentService({
                getLua: () => this.getLua(),
                executeInCurrentLock: <T>(code: string, ...args: unknown[]) =>
                    this.executionService.executeInCurrentLock<T>(code, ...args),
                withExecutionLock: <T>(op: () => Promise<T>) => this.withExecutionLock(op),
                mountFile: (path: string, content: string) => this.vfs.mount(path, content),
                getEventsApiIdentity: () => this.eventsApi,
            });

            for (const [name, value] of Object.entries(this.globals)) {
                if (value instanceof LuaClass) {
                    value.installSync(this.lua, name);
                } else {
                    this.lua.global.set(name, value);
                }
            }

            // Mount any pre-configured files via VfsRegistry
            await this.vfs.mountPending();

            this.state = 'initialized';

            // Process bindings
            if (this.pendingBindings.length > 0) {
                for (const factory of this.pendingBindings) {
                    const binding = factory({ bridge: this });
                    if (binding instanceof LuaBindings) {
                        await binding.install(this.lua);
                        this.activeBindings.push(binding);
                    }
                }
                this.pendingBindings = [];
            }
        } catch (error) {
            throw toBridgeError('Failed to initialize LuaBridge', error, ErrorCodes.NOT_INITIALIZED);
        }
    }

    /**
     * Stop loop state and close runtime resources.
     *
     * Safe to call even when runtime is not initialized.
     */
    close(): void {
        this.stopMainLoop();

        // Notify active bindings so they can release resources
        for (const binding of this.activeBindings) {
            try {
                binding.close();
            } catch {
                // Swallow per-binding cleanup errors
            }
        }
        this.activeBindings = [];

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
            throw toBridgeError('Failed to close LuaBridge', error, ErrorCodes.CLOSE);
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
            if (this.vfs.has(INIT_FILE)) {
                await this.executeFile(INIT_FILE);
            }
            await this.execute(CALL_ON_INIT_CODE);
            this.startMainLoop(intervalMs);
            this.started = true;
        } catch (error) {
            throw toBridgeError('Failed to start LuaBridge', error, ErrorCodes.START);
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
            throw toBridgeError('Failed to shutdown LuaBridge', error, ErrorCodes.SHUTDOWN);
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
    // deno-lint-ignore no-explicit-any
    on(event: string, handler: EventHandler<any[]>): () => boolean;
    // reason: implementation must accept all overload variants
    // deno-lint-ignore no-explicit-any
    on(event: string, handler: (...args: any[]) => void): () => boolean {
        return this.eventBus.on(event, handler);
    }

    /** Unregister listener for a strongly typed event key. */
    off<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): boolean;
    /** Unregister listener for dynamic/untyped event keys. */
    // deno-lint-ignore no-explicit-any
    off(event: string, handler: EventHandler<any[]>): boolean;
    // reason: implementation must accept all overload variants
    // deno-lint-ignore no-explicit-any
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
     * Reopen a closed bridge so it can be re-initialized.
     *
     * This clears the closed state and allows `init()` or `start()` to be called again.
     * All previously mounted files and event listeners are preserved.
     *
     * @returns `true` if reopen was performed, `false` if bridge was not in closed state.
     */
    reopen(): boolean {
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
     * @deprecated Use {@link Set} with individual calls instead. Will be removed in a future version.
     */
    setGlobals(values: Record<string, unknown>): void {
        this.getLua();
        this.executionService.setGlobals(values);
    }

    /**
     * Set global in both local cache and active Lua runtime.
     *
     * Strongly typed for known keys in `TGlobals`.
     * @deprecated Use {@link Set} instead. Will be removed in a future version.
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
        this.getLua();
        this.globals[name as keyof TGlobals] = value as TGlobals[keyof TGlobals];
        this.executionService.setGlobal(name, value);
    }

    /**
     * Read global value from active Lua runtime.
     *
     * Prefer keyed overload when global shape is known.
     * @deprecated Use {@link Get} instead. Will be removed in a future version.
     */
    getGlobal<K extends keyof TGlobals & string>(name: K): TGlobals[K];
    /** Read global value by dynamic key and optional generic type. */
    getGlobal<T = unknown>(name: string): T;
    getGlobal<T = unknown>(name: string): T {
        this.getLua();
        return this.executionService.getGlobal<T>(name);
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
     * const max = await bridge.getDeep('config.limits.max');     // 100
     * const dbg = await bridge.getDeep('config.debug', false);     // true
     * const missing = await bridge.getDeep('config.foo', 'fallback'); // 'fallback'
     * ```
     * @deprecated Use {@link Get} instead. Will be removed in a future version.
     */
    async getDeep<T = unknown>(path: string, defaultValue?: T): Promise<T | undefined> {
        this.getLua();
        return await this.executionService.getDeep(path, defaultValue);
    }

    /**
     * Write a deeply nested global value using a dot-delimited path.
     *
     * Unlike `setGlobal`, this traverses into tables and creates intermediate
     * tables when they don't exist.
     *
     * @example
     * ```ts
     * await bridge.setDeep('config.limits.max', 200);
     * // equivalent to: _G.config = _G.config or {}; config.limits = config.limits or {}; config.limits.max = 200
     * ```
     * @deprecated Use {@link Set} instead. Will be removed in a future version.
     */
    async setDeep(path: string, value: unknown): Promise<void> {
        this.getLua();
        await this.executionService.setDeep(path, value);
    }

    /**
     * Read a value from the Lua global namespace using a dot-delimited path.
     *
     * - Flat keys (no dots) → synchronous `_G` lookup via `getGlobal`.
     * - Dotted keys → async table traversal via `getDeep`.
     * - Returns `defaultValue` when the path is missing, or `undefined` if no default.
     * - `null` from wasmoon is normalized to `undefined` for consistency.
     *
     * @typeParam T - Expected return type.
     * @param path - Global key or dot-delimited path (e.g. `"x"` or `"config.limits.max"`).
     * @param defaultValue - Optional fallback when the value is missing.
     *
     * @example
     * ```ts
     * const x = await bridge.Get<number>('x');
     * const max = await bridge.Get<number>('config.limits.max', 100);
     * ```
     */
    Get<K extends keyof TGlobals & string>(path: K): Promise<TGlobals[K]>;
    Get<T = unknown>(path: string, defaultValue?: T): Promise<T | undefined>;
    async Get<T = unknown>(path: string, defaultValue?: T): Promise<T | undefined> {
        this.getLua();
        if (path.includes('.')) {
            return await this.executionService.getDeep<T | undefined>(path, defaultValue);
        }
        const raw = this.executionService.getGlobal<T | null>(path);
        const v: T | undefined = raw === null ? undefined : raw as T;
        return v !== undefined ? v : defaultValue;
    }

    /**
     * Write a value into the Lua global namespace using a dot-delimited path.
     *
     * - `value instanceof LuaClass` → uses `installSync` (flat paths only).
     * - Flat keys (no dots) → synchronous `_G` write via `setGlobal`.
     * - Dotted keys → async table traversal with auto-created intermediates via `setDeep`.
     * - The internal globals cache is updated for flat keys.
     *
     * @param path - Global key or dot-delimited path (e.g. `"x"` or `"config.limits.max"`).
     * @param value - Value to set. LuaClass instances are installed specially.
     *
     * @example
     * ```ts
     * await bridge.Set('x', 42);
     * await bridge.Set('config.limits.max', 200);
     * ```
     */
    async Set(path: string, value: unknown): Promise<void> {
        this.getLua();
        if (value instanceof LuaClass) {
            if (path.includes('.')) {
                throw new BridgeError('LuaClass install only supports flat paths', ErrorCodes.SET_GLOBAL);
            }
            value.installSync(this.getLua(), path);
            this.globals[path as keyof TGlobals] = value as TGlobals[keyof TGlobals];
            return;
        }
        if (path.includes('.')) {
            await this.executionService.setDeep(path, value);
            // Also update the globals cache so reopen/init preserves dotted writes
            const parts = path.split('.');
            let cursor: Record<string, unknown> = this.globals as unknown as Record<string, unknown>;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!(part in cursor) || typeof cursor[part] !== 'object' || cursor[part] === null) {
                    cursor[part] = {};
                }
                cursor = cursor[part] as Record<string, unknown>;
            }
            cursor[parts[parts.length - 1]] = value as TGlobals[keyof TGlobals];
            return;
        }
        this.globals[path as keyof TGlobals] = value as TGlobals[keyof TGlobals];
        this.executionService.setGlobal(path, value);
    }

    /**
     * Get a callable handle to a Lua global function.
     *
     * Returns a fresh JS wrapper each call (no caching). The wrapper
     * resolves the function name at call time, reflecting Lua state
     * mutations between calls.
     *
     * @typeParam T - Function signature for typing.
     * @param name - Lua global function name.
     *
     * @example
     * ```ts
     * const add = bridge.GetFunction<(a: number, b: number) => number>('add');
     * const sum = await add(40, 2); // 42
     * ```
     */
    // deno-lint-ignore no-explicit-any
    GetFunction<T extends (...args: any[]) => unknown>(name: string): T {
        this.getLua();
        // Fresh wrapper per call — no caching. Resolves name at call time.
        return ((...args: unknown[]) => this.call(name, ...args)) as unknown as T;
    }

    /**
     * Get a callable handle to a Lua method with `self` binding.
     *
     * For dotted paths like `"game.getPlayer"`, the parent table (`_G.game`)
     * is resolved fresh each call and passed as the first argument (`self`),
     * matching Lua's `obj:method(args)` calling convention.
     *
     * For flat names (no dots), behaves identically to `GetFunction`.
     *
     * Throws a `BridgeError` (code `LUA_EXECUTION_ERROR`) if the method
     * cannot be resolved (e.g., parent path doesn't exist or is not a table).
     *
     * @typeParam T - Method signature for typing.
     * @param path - Method path, e.g. `"game.getPlayer"` or `"table.method"`.
     *
     * @example
     * ```ts
     * const getPlayer = bridge.GetMethod<(id: number) => Player>('game.getPlayer');
     * const player = await getPlayer(42); // calls _G.game.getPlayer(_G.game, 42)
     * ```
     */
    // deno-lint-ignore no-explicit-any
    GetMethod<T extends (...args: any[]) => unknown>(path: string): T {
        this.getLua();
        const SAFE_PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
        if (!SAFE_PATH.test(path)) {
            throw new BridgeError(
                `Invalid method path: ${path}. Only dot-delimited identifier paths are supported.`,
                ErrorCodes.CALL,
            );
        }
        const lastDot = path.lastIndexOf('.');
        if (lastDot === -1) {
            return this.GetFunction<T>(path);
        }
        const methodName = path.slice(lastDot + 1);
        return (async (...args: unknown[]) => {
            // Resolve parent via Lua: local self = <parent_path>; return self.<method>(self, ...)
            return await this.execute(
                `local self = ${path.slice(0, lastDot)}\nreturn self.${methodName}(self, ...)`,
                ...args,
            );
        }) as unknown as T;
    }

    /**
     * Set a JS function as a Lua global.
     *
     * Thin wrapper around `Set` for documentation clarity.
     *
     * @param name - Global function name.
     * @param fn - JS function to expose.
     */
    // deno-lint-ignore no-explicit-any
    async SetFunction<T extends (...args: any[]) => unknown>(name: string, fn: T): Promise<void> {
        await this.Set(name, fn);
    }

    /**
     * Set a JS function as a method on a Lua table.
     *
     * Thin wrapper around `Set` for documentation clarity.
     *
     * @param path - Dot-delimited path, e.g. `"game.getPlayer"`.
     * @param fn - JS function to expose.
     */
    // deno-lint-ignore no-explicit-any
    async SetMethod<T extends (...args: any[]) => unknown>(path: string, fn: T): Promise<void> {
        await this.Set(path, fn);
    }

    /**
     * Set a field on a global Lua table.
     *
     * @deprecated Use {@link Set} with a dotted path (e.g., `Set("table.field", value)`) instead. Will be removed in a future version.
     */
    setField(tableName: string, field: string, value: unknown): void {
        this.getLua();
        this.executionService.setField(tableName, field, value);
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
        this.getLua();
        await this.executionService.loadCommon(injectGlobals);
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
        this.getLua();
        this.executionService.onPrint(callback);
    }

    /**
     * Get current Lua memory usage in bytes.
     * Requires `traceAllocations: true` in runtime options for accurate tracking.
     *
     * @returns Memory used in bytes, or 0 if not available.
     */
    getMemoryUsed(): number {
        this.getLua();
        return this.executionService.getMemoryUsed();
    }

    /**
     * Get the current Lua memory cap (max allocatable bytes).
     *
     * @returns Maximum memory in bytes, or `undefined` if no limit is set.
     */
    getMemoryMax(): number | undefined {
        this.getLua();
        return this.executionService.getMemoryMax();
    }

    /**
     * Set a hard memory cap for the Lua runtime.
     *
     * When the limit is exceeded, allocations will fail with an out-of-memory error.
     *
     * @param max Maximum memory in bytes, or `undefined` to remove the limit.
     */
    setMemoryMax(max: number | undefined): void {
        this.getLua();
        this.executionService.setMemoryMax(max);
    }

    /**
     * Dump the current Lua stack to the console (or custom logger) for debugging.
     *
     * @param log Optional logger function (defaults to `console.log`).
     */
    dumpStack(log?: (...data: unknown[]) => void): void {
        this.getLua();
        this.executionService.dumpStack(log);
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
        this.getLua();
        return await this.withExecutionLock(
            () => this.executionService.call(name, ...args),
        );
    }

    /**
     * Load a module directly into `package.loaded[moduleName]`.
     *
     * @param name Module key used by `require(name)`.
     * @param code Lua module body code.
     */
    async loadModule(name: string, code: string): Promise<void> {
        this.getLua();
        await this.executionService.loadModule(name, code);
    }

    /** Execute Lua source string in the current runtime. */
    async execute<T = unknown>(code: string, ...args: unknown[]): Promise<T> {
        this.getLua();
        return await this.withExecutionLock(
            () => this.executionService.executeInCurrentLock<T>(code, ...args),
        );
    }

    /** Execute a mounted Lua file in the current runtime. */
    async executeFile<T = unknown>(file: string, ...args: unknown[]): Promise<T> {
        this.getLua();
        return await this.executionService.executeFile(file, ...args);
    }

    /**
     * Execute Lua source synchronously, bypassing the execution lock.
     *
     * ⚠️ Use only when async execution is not possible. Can cause race conditions
     * if async operations are in flight.
     */
    executeRaw<T = unknown>(code: string): T {
        this.getLua();
        return this.executionService.executeRaw(code);
    }

    /**
     * Execute a mounted Lua file synchronously, bypassing the execution lock.
     *
     * ⚠️ Use only when async execution is not possible. Can cause race conditions
     * if async operations are in flight.
     */
    executeFileRaw<T = unknown>(file: string): T {
        this.getLua();
        return this.executionService.executeFileRaw(file);
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
        this.getLua();
        return await this.environmentService.useEnvironment(env, options);
    }

    /**
     * Mount a file into Wasmoon's in-memory Lua filesystem.
     *
     * Mounted files can be run via `executeFile(...)` or required from Lua.
     */
    async mountFile(file: string, content: string): Promise<void> {
        this.assertInitialized();
        try {
            await this.vfs.mount(file, content);
        } catch (error) {
            throw toBridgeError('Failed to mount file', error, ErrorCodes.FILE);
        }
    }
}

export default LuaBridge;

/**
 * Create and initialize a new `LuaBridge`.
 *
 * @typeParam TGlobals Known global map used for typed `Get`/`Set` keys.
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

