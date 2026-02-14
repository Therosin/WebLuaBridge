import { LuaFactory } from 'npm:wasmoon@1.16.0';

const DEFAULT_RUNTIME_OPTIONS = {
    openStandardLibs: true,
    injectObjects: true,
    enableProxy: true,
    traceAllocations: false,
    functionTimeout: 1000,
};

const NOT_INITIALIZED_ERROR = 'LuaBridge not initialized';
const UNKNOWN_ERROR = 'Unknown error';
const ENV_GLOBAL_NAME = '__lua_bridge_env';
const INIT_FILE = 'init.lua';
const DEFAULT_TICK_INTERVAL_MS = 16;
const CALL_ON_INIT_CODE = "local fn = _G.OnInit; if type(fn) == 'function' then return fn(...) end";
const CALL_UPDATE_CODE = "local fn = _G.Update; if type(fn) == 'function' then return fn(...) end";
const CALL_ON_SHUTDOWN_CODE = "local fn = _G.OnShutdown; if type(fn) == 'function' then return fn(...) end";
const COMPAT_ARGS_GLOBAL = 'args';

const getErrorMessage = (error: any): string => error?.message || UNKNOWN_ERROR;
const toBridgeError = (context: string, error: unknown): Error => new Error(`${context}: ${getErrorMessage(error)}`);
const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const toLuaLongString = (value: string): string => {
    let equals = '';
    while (value.includes(`]${equals}]`)) {
        equals += '=';
    }
    return `[${equals}[${value}]${equals}]`;
};

const normalizeRuntimeOptions = (options: Record<string, any> = {}): Record<string, any> => {
    const runtimeOptions = { ...DEFAULT_RUNTIME_OPTIONS, ...options };
    if (runtimeOptions.functionTimeout != null) {
        if (typeof runtimeOptions.functionTimeout !== 'number' || runtimeOptions.functionTimeout < 0) {
            throw new Error('functionTimeout must be a non-negative number or undefined');
        }
    }
    return runtimeOptions;
};

class BridgeEventBus {
    listeners: Map<string, Set<(...args: any[]) => void>>;

    constructor() {
        this.listeners = new Map();
    }

    on(event: string, handler: (...args: any[]) => void): () => boolean {
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

    off(event: string, handler: (...args: any[]) => void): boolean {
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

    emit(event: string, ...args: any[]): number {
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
 * Wraps the code in an anonymous function and injects the args array
 * @param {string} code - The Lua code to wrap
 * @returns {string} - The wrapped Lua code
 * @example
 * const code = `
 *    local function multiply(a, b)
 *       return a * b
 *    end
 *   return multiply(...)
 * `;
 */
const LuaWrap = (code: string, argsGlobalName: string = COMPAT_ARGS_GLOBAL): string => {
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

class LuaBridge {
    factory: LuaFactory;
    globals: Record<string, any>;
    runtimeOptions: Record<string, any>;
    lua: any;
    state: 'new' | 'initialized' | 'closed';
    eventBus: BridgeEventBus;
    eventsApi: {
        On: (...args: any[]) => any;
        Off: (...args: any[]) => any;
        Emit: (...args: any[]) => any;
    };
    mountedFiles: Set<string>;
    started: boolean;
    mainLoop: {
        active: boolean;
        timer: ReturnType<typeof setTimeout> | null;
        intervalMs: number;
        lastTickAt: number;
        runningTick: boolean;
    };
    executionQueue: Promise<any>;
    argsKeyCounter: number;

    /**
     * Creates a new LuaBridge instance
     * @param {Object} [globals={}] - Global variables to inject into the Lua environment
     * @param {Object} [options={}] - Runtime/sandbox options forwarded to wasmoon
     */
    constructor(globals: any = {}, options: Record<string, any> = {}) {
        // Allow constructor({ globals, runtime }) while preserving constructor(globals, runtime).
        if (isObject(globals) && ('globals' in globals || 'runtime' in globals) && Object.keys(options).length === 0) {
            const config = globals as { globals?: Record<string, any>, runtime?: Record<string, any> };
            options = config.runtime || {};
            globals = config.globals || {};
        }

        this.factory = new LuaFactory();
        this.globals = globals;
        this.runtimeOptions = normalizeRuntimeOptions(options);
        this.lua = null;
        this.state = 'new';
        this.eventBus = new BridgeEventBus();
        this.eventsApi = this.createEventsApi();
        this.mountedFiles = new Set();
        this.started = false;
        this.mainLoop = {
            active: false,
            timer: null,
            intervalMs: DEFAULT_TICK_INTERVAL_MS,
            lastTickAt: 0,
            runningTick: false,
        };
        this.executionQueue = Promise.resolve();
        this.argsKeyCounter = 0;
    }

    assertInitialized() {
        if (!this.lua) {
            throw new Error(NOT_INITIALIZED_ERROR);
        }
    }

    async withExecutionLock<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.executionQueue.then(operation);
        this.executionQueue = run.catch(() => undefined);
        return await run;
    }

    nextArgsKey() {
        this.argsKeyCounter += 1;
        return `__lua_bridge_args_${this.argsKeyCounter}`;
    }

    async withScopedCompatArgs(args: any[], operation: () => Promise<any>): Promise<any> {
        if (!args || args.length === 0) {
            return await operation();
        }

        const previousArgs = this.lua.global.get(COMPAT_ARGS_GLOBAL);
        this.lua.global.set(COMPAT_ARGS_GLOBAL, args);
        try {
            return await operation();
        } finally {
            this.lua.global.set(COMPAT_ARGS_GLOBAL, previousArgs);
        }
    }

    /**
     * Initializes the Lua environment
     * @returns {Promise<void>}
     * @throws {Error} If the Lua environment fails to initialize
     */
    async init() {
        if (this.state === 'initialized') {
            return;
        }

        try {
            this.lua = await this.factory.createEngine(this.runtimeOptions);
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
     * Closes the Lua environment
     * @throws {Error} If the Lua environment fails to close
     */
    close() {
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

    scheduleMainLoopTick() {
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

    startMainLoop(intervalMs = DEFAULT_TICK_INTERVAL_MS) {
        this.assertInitialized();
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

    stopMainLoop() {
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
     * Starts runtime lifecycle:
     * - executes init.lua if mounted
     * - executes _G.OnInit() if present
     * - starts JS-driven update loop calling _G.Update(dt) if present
     * @param {Object} [options={}]
     * @param {number} [options.intervalMs=16] - Tick interval in milliseconds
     * @returns {Promise<void>}
     */
    async start(options: { intervalMs?: number } = {}) {
        const { intervalMs = DEFAULT_TICK_INTERVAL_MS } = options;
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
     * Stops runtime lifecycle:
     * - stops JS-driven update loop
     * - executes _G.OnShutdown() if present
     * - closes Lua runtime
     * @returns {Promise<void>}
     */
    async shutdown() {
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

    normalizeLuaMethodArgs(args) {
        // Lua `:` method syntax passes `self` as the first arg.
        if (args.length > 0 && args[0] === this.eventsApi) {
            return args.slice(1);
        }
        if (args.length > 1 && typeof args[0] !== 'string' && typeof args[1] === 'string') {
            return args.slice(1);
        }
        return args;
    }

    extractEventAndHandler(args) {
        const normalized = this.normalizeLuaMethodArgs(args);
        const [event, handler] = normalized;
        if (typeof event !== 'string' || event.length === 0) {
            throw new Error('Event name must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('Event handler must be a function');
        }
        return [event, handler];
    }

    createEventsApi() {
        return {
            On: (...args) => {
                const [event, handler] = this.extractEventAndHandler(args);
                return this.eventBus.on(event, handler);
            },
            Off: (...args) => {
                const [event, handler] = this.extractEventAndHandler(args);
                return this.eventBus.off(event, handler);
            },
            Emit: (...args) => {
                const normalized = this.normalizeLuaMethodArgs(args);
                const [event, ...payload] = normalized;
                if (typeof event !== 'string' || event.length === 0) {
                    throw new Error('Event name must be a non-empty string');
                }
                return this.eventBus.emit(event, ...payload);
            },
        };
    }

    on(event, handler) {
        return this.eventBus.on(event, handler);
    }

    off(event, handler) {
        return this.eventBus.off(event, handler);
    }

    emit(event, ...args) {
        return this.eventBus.emit(event, ...args);
    }


    /**
     * Sets a global variable in the Lua environment
     * @param {string} name - The name of the global variable
     * @param {any} value - The value of the global variable
     * @throws {Error} If the global variable cannot be set
     */
    setGlobal(name, value) {
        try {
            this.assertInitialized();
            this.globals[name] = value;
            this.lua.global.set(name, value);
        } catch (error) {
            throw toBridgeError('Failed to set global', error);
        }
    }


    /**
     * Gets a global variable from the Lua environment
     * @param {string} name - The name of the global variable
     * @returns {any} - The value of the global variable
     * @throws {Error} If the global variable cannot be retrieved
     */
    getGlobal(name) {
        try {
            this.assertInitialized();
            return this.lua.global.get(name);
        } catch (error) {
            throw toBridgeError('Failed to get global', error);
        }
    }


    /**
     * Set a field in a Lua table
     * @param {string} table - The name of the table
     * @param {string} field - The name of the field
     * @param {any} value - The value to set
     * @throws {Error} If the field cannot be set
    */
    setField(table, field, value) {
        try {
            this.assertInitialized();
            this.lua.global.getTable(table, (index) => {
                this.lua.global.setField(index, field, value);
            });
        } catch (error) {
            throw toBridgeError('Failed to set field', error);
        }
    }


    /**
     * Injects a script into package.loaded
     * @param {string} name - Name of the module
     * @param {string} code - Lua code to inject
     * @returns {Promise<void>}
     * @throws {Error} If the module fails to load
     */
    async loadModule(name, code) {
        this.assertInitialized();
        return await this.withExecutionLock(async () => {
            try {
                if (typeof name !== 'string' || name.length === 0) {
                    throw new Error('Module name must be a non-empty string');
                }
                if (typeof code !== 'string') {
                    throw new Error('Module code must be a string');
                }

                const moduleNameKey = `__lua_bridge_module_name_${this.nextArgsKey()}`;
                this.lua.global.set(moduleNameKey, name);
                try {
                    await this.lua.doString(`
                        local __module_name = _G['${moduleNameKey}']
                        _G['${moduleNameKey}'] = nil
                        package.loaded[__module_name] = (function(...) ${code} end)()
                    `);
                } finally {
                    this.lua.global.set(moduleNameKey, undefined);
                }
            } catch (error) {
                throw toBridgeError('Failed to load module', error);
            }
        });
    }

    /**
     * Executes Lua code in the environment
     * @param {string} code - The Lua code to execute
     * @param {...any} args - Arguments to pass to the Lua code
     * @returns {Promise<any>} - The result of the Lua code execution
     * @throws {Error} If the Lua code execution fails
     */
    async execute(code, ...args) {
        this.assertInitialized();
        return await this.withExecutionLock(async () => {
            try {
                if (args.length > 0) {
                    const argsGlobalName = this.nextArgsKey();
                    this.lua.global.set(argsGlobalName, args);
                    code = LuaWrap(code, argsGlobalName);
                    try {
                        return await this.lua.doString(code);
                    } finally {
                        this.lua.global.set(argsGlobalName, undefined);
                    }
                }
                return await this.lua.doString(code);
            } catch (error) {
                throw toBridgeError('Failed to execute code', error);
            }
        });
    }

    async executeFile(file, ...args) {
        this.assertInitialized();
        return await this.withExecutionLock(async () => {
            try {
                return await this.withScopedCompatArgs(args, async () => {
                    return await this.lua.doFile(file);
                });
            } catch (error) {
                throw toBridgeError('Failed to execute file', error);
            }
        });
    }

    /**
     * Returns a proxy that allows executing Lua functions/files within a specific environment
     * @param {object} env - The environment to use for executing Lua code
     * @returns {Object} - A proxy object with execute and executeFile methods
     * @throws {Error} If the environment cannot be used
    */
    async useEnvironment(env: Record<string, any>) {
        this.assertInitialized();
        try {
            if (!isObject(env)) {
                throw new Error('Environment must be an object');
            }

            const withEnvironment = async (callback) => {
                this.lua.global.set(ENV_GLOBAL_NAME, env);
                try {
                    return await callback();
                } finally {
                    this.lua.global.set(ENV_GLOBAL_NAME, undefined);
                }
            };

            return {
                execute: async (code, ...args) => {
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
                    return await withEnvironment(() => this.execute(wrappedCode, ...args));
                },
                executeFile: async (file, ...args) => {
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
                    return await withEnvironment(() => this.execute(wrappedCode, ...args));
                },
            };
        } catch (error) {
            throw toBridgeError('Failed to use environment', error);
        }
    }

    /**
     * mount a file into the lua environment
     * @param {string} file - The path to the file in the lua environment
     * @param {string} content - The content of the file
     * @returns {Promise<void>}
     * @throws {Error} If the file cannot be mounted
     * @example
     * await lua.mountFile('hello/init.lua', 'print("Hello, World!")');
     * await lua.execute('require("hello/init")');
    */
    async mountFile(file, content) {
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
 * Create a new LuaBridge instance
 * @param {Object} [globals={}] - Global variables to inject into the Lua environment
 * @param {Object} [options={}] - Runtime/sandbox options forwarded to wasmoon
 * @returns {Promise<LuaBridge>} - LuaBridge instance
 */
export async function createLuaBridge(globals = {}, options = {}) {
    const lua = new LuaBridge(globals, options);
    await lua.init();
    return lua;
};

/**
 * Run Lua code in an isolated LuaBridge instance
 * @param {string} code - Lua code to run
 * @param {any[]} args - Arguments to pass to the Lua code
 * @returns {Promise<any>} - Result of the Lua code
 * @throws {Error} If the Lua code execution fails
 */
export async function runLuaCode(code, ...args) {
    const lua = await createLuaBridge();
    try {
        const result = await lua.execute(code, ...args);
        lua.close();
        return result;
    } catch (error) {
        lua.close();
        throw error;
    }
};
