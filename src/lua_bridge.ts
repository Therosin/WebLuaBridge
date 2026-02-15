import { LuaFactory } from 'npm:wasmoon@1.16.0';

/** Default Wasmoon runtime options used when no overrides are provided. */
const DEFAULT_RUNTIME_OPTIONS = {
    openStandardLibs: true,
    injectObjects: true,
    enableProxy: true,
    traceAllocations: false,
    functionTimeout: 1000,
} as const;

/** Error used when runtime-dependent operations are invoked before `init()`. */
const NOT_INITIALIZED_ERROR = 'LuaBridge not initialized';
/** Fallback error message for unknown throwable values. */
const UNKNOWN_ERROR = 'Unknown error';
/** Internal global key used to pass scoped environment objects into Lua wrappers. */
const ENV_GLOBAL_NAME = '__lua_bridge_env';
/** Optional lifecycle boot file checked during `start()`. */
const INIT_FILE = 'init.lua';
/** Default JS timer interval used for the update loop. */
const DEFAULT_TICK_INTERVAL_MS = 16;
/** Lua snippet that calls `_G.OnInit(...)` when defined. */
const CALL_ON_INIT_CODE = "local fn = _G.OnInit; if type(fn) == 'function' then return fn(...) end";
/** Lua snippet that calls `_G.Update(dt)` when defined. */
const CALL_UPDATE_CODE = "local fn = _G.Update; if type(fn) == 'function' then return fn(...) end";
/** Lua snippet that calls `_G.OnShutdown(...)` when defined. */
const CALL_ON_SHUTDOWN_CODE = "local fn = _G.OnShutdown; if type(fn) == 'function' then return fn(...) end";
/** Legacy argument global used by `executeFile` compatibility mode. */
const COMPAT_ARGS_GLOBAL = 'args';

/** Tuple-like payload map used for typed bridge events. */
export type LuaBridgeEventMap = Record<string, unknown[]>;

/** Handler shape used by the bridge event bus. */
export type EventHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void;

/** Internal lifecycle state for the runtime instance. */
type BridgeState = 'new' | 'initialized' | 'closed';

/** Internal JS timer state for the update loop. */
type RuntimeLoopState = {
    active: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    intervalMs: number;
    lastTickAt: number;
    runningTick: boolean;
};

/** Start-time options for runtime lifecycle mode. */
export type RuntimeStartOptions = {
    /** Tick interval, in milliseconds, for `_G.Update(dt)` calls. */
    intervalMs?: number;
};

/** Runtime options accepted by Wasmoon when creating the engine. */
export type LuaRuntimeOptions = {
    /** Open Lua standard libraries (`base`, `table`, etc). */
    openStandardLibs?: boolean;
    /** Inject JS objects directly as Lua-compatible values. */
    injectObjects?: boolean;
    /** Enable proxy behavior for object bridge access. */
    enableProxy?: boolean;
    /** Track allocation metadata for diagnostics. */
    traceAllocations?: boolean;
    /** Maximum execution time per Lua function call in milliseconds. */
    functionTimeout?: number;
} & Record<string, unknown>;

/** All options accepted by `LuaBridge`. */
export type LuaBridgeOptions = LuaRuntimeOptions & {
    /** Default interval used when the main loop is started without explicit interval. */
    mainLoopIntervalMs?: number;
};

/** Global values injected into Lua `_G` during initialization. */
export type LuaBridgeGlobals = Record<string, unknown>;

/**
 * Scoped execution context returned by `useEnvironment()`.
 *
 * `execute` and `executeFile` run with an isolated environment table that falls back to `_G`.
 */
export interface LuaExecutionContext<TEnv extends Record<string, unknown> = Record<string, unknown>> {
    /** Original object used as the environment backing store. */
    readonly environment: TEnv;
    /** Execute Lua source inside the scoped environment table. */
    execute<T = unknown>(code: string, ...args: unknown[]): Promise<T>;
    /** Execute a mounted Lua file inside the scoped environment table. */
    executeFile<T = unknown>(file: string, ...args: unknown[]): Promise<T>;
}

/** Public event methods shape for editor autocomplete. */
export interface LuaBridgeEventApi<TEvents extends LuaBridgeEventMap = LuaBridgeEventMap> {
    /** Register listener for a strongly typed event key. */
    on<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): () => boolean;
    /** Register listener for dynamic/untyped event keys. */
    on(event: string, handler: EventHandler): () => boolean;
    /** Unregister listener for a strongly typed event key. */
    off<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): boolean;
    /** Unregister listener for dynamic/untyped event keys. */
    off(event: string, handler: EventHandler): boolean;
    /** Emit a strongly typed event payload. */
    emit<K extends keyof TEvents & string>(event: K, ...args: TEvents[K]): number;
    /** Emit a dynamic/untyped event payload. */
    emit(event: string, ...args: unknown[]): number;
}

/** Minimal global bridge contract required from Wasmoon runtime globals object. */
interface LuaGlobalHandle {
    set(name: string, value: unknown): void;
    get<T = unknown>(name: string): T;
    close(): void;
    getTable(name: string, callback: (index: number) => void): void;
    setField(index: number, field: string, value: unknown): void;
}

/** Minimal runtime engine contract used by this module. */
interface LuaEngine {
    global: LuaGlobalHandle;
    doString<T = unknown>(code: string): Promise<T>;
    doFile<T = unknown>(file: string): Promise<T>;
}

/**
 * Lua-facing events API injected as `Events` global.
 *
 * Method names are PascalCase for Lua ergonomics (`Events:On(...)`).
 */
interface BridgeEventsApi {
    On: (...args: unknown[]) => () => boolean;
    Off: (...args: unknown[]) => boolean;
    Emit: (...args: unknown[]) => number;
}

/** Convert unknown thrown values into stable user-facing error messages. */
const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return UNKNOWN_ERROR;
};

/** Prefix internal errors with operation context for easier debugging. */
const toBridgeError = (context: string, error: unknown): Error => new Error(`${context}: ${getErrorMessage(error)}`);

/** Narrow unknown values to plain object records. */
const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Serialize arbitrary string content as a Lua long-bracket literal.
 *
 * Uses dynamic `=` padding to avoid accidental closing delimiters inside content.
 */
const toLuaLongString = (value: string): string => {
    let equals = '';
    while (value.includes(`]${equals}]`)) {
        equals += '=';
    }
    return `[${equals}[${value}]${equals}]`;
};

/** Validate and normalize runtime options before creating the Wasmoon engine. */
const normalizeRuntimeOptions = (options: Partial<LuaRuntimeOptions> = {}): LuaRuntimeOptions => {
    const runtimeOptions: LuaRuntimeOptions = { ...DEFAULT_RUNTIME_OPTIONS, ...options };
    if (runtimeOptions.functionTimeout != null) {
        if (typeof runtimeOptions.functionTimeout !== 'number' || runtimeOptions.functionTimeout < 0) {
            throw new Error('functionTimeout must be a non-negative number or undefined');
        }
    }
    return runtimeOptions;
};

/** Validate configured main-loop interval and return an explicit value. */
const normalizeMainLoopInterval = (value: number | undefined): number => {
    if (value == null) {
        return DEFAULT_TICK_INTERVAL_MS;
    }
    if (typeof value !== 'number' || value <= 0) {
        throw new Error('mainLoopIntervalMs must be a positive number or undefined');
    }
    return value;
};

/**
 * Internal event bus shared by Lua and JS callers.
 *
 * Stores listeners by string key and supports stable removal through returned unsubscribe callbacks.
 */
class BridgeEventBus<TEvents extends LuaBridgeEventMap = LuaBridgeEventMap> {
    /** Map of event names to listener sets. */
    private listeners: Map<string, Set<EventHandler>>;

    constructor() {
        this.listeners = new Map();
    }

    /** Register a listener and return an unsubscribe function. */
    on(event: string, handler: EventHandler): () => boolean {
        if (typeof event !== 'string' || event.length === 0) {
            throw new Error('Event name must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('Event handler must be a function');
        }

        let handlers = this.listeners.get(event);
        if (!handlers) {
            handlers = new Set();
            this.listeners.set(event, handlers);
        }
        handlers.add(handler);

        return () => this.off(event, handler);
    }

    /** Remove a listener from a named event. */
    off(event: string, handler: EventHandler): boolean {
        const handlers = this.listeners.get(event);
        if (!handlers) {
            return false;
        }

        const removed = handlers.delete(handler);
        if (handlers.size === 0) {
            this.listeners.delete(event);
        }
        return removed;
    }

    /** Emit an event and return number of handlers that were invoked. */
    emit(event: string, ...args: unknown[]): number {
        const handlers = this.listeners.get(event);
        if (!handlers || handlers.size === 0) {
            return 0;
        }

        let invoked = 0;
        for (const handler of [...handlers]) {
            handler(...args);
            invoked += 1;
        }
        return invoked;
    }
}

/**
 * Wrap Lua source in a callable `main(...)` function that pulls bridge arguments from `_G`.
 *
 * This preserves support for passing JS arguments into arbitrary code snippets.
 */
const luaWrap = (code: string, argsGlobalName: string = COMPAT_ARGS_GLOBAL): string => {
    const argsKeyLiteral = toLuaLongString(argsGlobalName);
    return `
        local args = rawget(_G, ${argsKeyLiteral}) or {}
        rawset(_G, ${argsKeyLiteral}, nil)
        local function main(...)
            ${code}
        end
        return main(table.unpack(args))
    `;
};

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

    /**
     * Create a new bridge instance.
     *
     * @param globals Globals injected into Lua `_G` during `init()`.
     * @param options Runtime and lifecycle options.
     */
    constructor(globals: TGlobals = {} as TGlobals, options: LuaBridgeOptions = {}) {
        const { mainLoopIntervalMs, ...runtimeOptions } = options;

        this.factory = new LuaFactory();
        this.globals = globals;
        this.runtimeOptions = normalizeRuntimeOptions(runtimeOptions);
        this.lua = null;
        this.state = 'new';
        this.eventBus = new BridgeEventBus<TEvents>();
        this.eventsApi = this.createEventsApi();
        this.mountedFiles = new Set();
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
                this.lua.global.set(name, value);
            }
            this.state = 'initialized';
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
     * Set global in both local cache and active Lua runtime.
     *
     * Strongly typed for known keys in `TGlobals`.
     */
    setGlobal<K extends keyof TGlobals & string>(name: K, value: TGlobals[K]): void;
    /** Set global by dynamic key when shape is not known at compile time. */
    setGlobal(name: string, value: unknown): void;
    setGlobal(name: string, value: unknown): void {
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
                    return await lua.doFile<T>(file);
                });
            } catch (error) {
                throw toBridgeError('Failed to execute file', error);
            }
        });
    }

    /**
     * Build a scoped execution proxy backed by a custom environment object.
     *
     * Reads resolve from `env` first, then `_G`; writes always target `env`.
     */
    async useEnvironment<TEnv extends Record<string, unknown>>(env: TEnv): Promise<LuaExecutionContext<TEnv>> {
        const lua = this.getLua();
        try {
            if (!isObject(env)) {
                throw new Error('Environment must be an object');
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

            return {
                environment: env,
                execute: async <T = unknown>(code: string, ...args: unknown[]): Promise<T> => {
                    const wrappedCode = `
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
local __chunk = assert(load(${toLuaLongString(code)}, nil, 't', __scope))
return __chunk(...)
`;
                    return await withEnvironment(() => this.executeInCurrentLock<T>(wrappedCode, ...args));
                },
                executeFile: async <T = unknown>(file: string, ...args: unknown[]): Promise<T> => {
                    const wrappedCode = `
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
local __chunk = assert(loadfile(${toLuaLongString(file)}, 't', __scope))
return __chunk(...)
`;
                    return await withEnvironment(() => this.executeInCurrentLock<T>(wrappedCode, ...args));
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
            if (args.length > 0) {
                const argsGlobalName = this.nextArgsKey();
                lua.global.set(argsGlobalName, args);
                const wrappedCode = luaWrap(code, argsGlobalName);
                try {
                    return await lua.doString<T>(wrappedCode);
                } finally {
                    lua.global.set(argsGlobalName, undefined);
                }
            }
            return await lua.doString<T>(code);
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
