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

/** Tuple-like payload map used for typed bridge events. */
export type LuaBridgeEventMap = Record<string, unknown[]>;

/** Handler shape used by the bridge event bus. */
export type EventHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void;

/** Internal lifecycle state for the runtime instance. */
export type BridgeState = 'new' | 'initialized' | 'closed';

/** Internal JS timer state for the update loop. */
export type RuntimeLoopState = {
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
    /** Custom WASM URI for the Lua runtime (e.g., a data URI for self-contained bundles). */
    wasmUri?: string;
    /** Binding factories to install during initialization. */
    bindings?: LuaBindingFactory[];
    /**
     * Files to mount into the Lua filesystem before any execution.
     * Key is the file path, value is the content.
     *
     * @example
     * ```ts
     * const bridge = await createLuaBridge({}, {
     *   files: {
     *     'lib/utils.lua': 'function add(a,b) return a+b end',
     *     'config.lua': 'return { debug = true }',
     *   }
     * });
     * ```
     */
    files?: Record<string, string>;
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
    /**
     * Mount a file into the Lua filesystem associated with this scope.
     * Mounted files are available via `require()` or `executeFile()`.
     */
    mountFile(path: string, content: string): Promise<void>;

    // ── Environment introspection & manipulation ──

    /** Get a value from the environment. */
    get<T = unknown>(key: string): T;
    /** Set a value in the environment. */
    set(key: string, value: unknown): void;
    /** Check if a key exists in the environment. */
    has(key: string): boolean;
    /** Remove a key from the environment. Returns true if the key existed. */
    delete(key: string): boolean;
    /** List all keys in the environment. */
    keys(): string[];
    /** Batch-assign multiple values into the environment. */
    assign(pairs: Record<string, unknown>): void;
    /** Remove all entries from the environment. */
    clear(): void;

    // ── Convenience execution helpers ──

    /**
     * Evaluate a Lua expression and return its result.
     *
     * The expression is evaluated with the same scoped environment
     * as `execute()`, so it can reference environment variables
     * and global Lua functions.
     *
     * @example
     * ```ts
     * const result = await scope.eval('greeting .. ", " .. name');
     * // equivalent to: await scope.execute('return greeting .. ", " .. name');
     * ```
     */
    eval<T = unknown>(expression: string): Promise<T>;
    /**
     * Call a named Lua function with arguments.
     *
     * The function is resolved from the scope environment (env vars first,
     * then `_G`), so it works with both JS-injected functions and
     * Lua-defined globals.
     *
     * @example
     * ```ts
     * await scope.call('print', 'hello world');
     * const max = await scope.call<number>('math.max', 3, 7, 2);
     * ```
     */
    call<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
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

/** Global bridge contract for Wasmoon runtime globals object. */
export interface LuaGlobalHandle {
    set(name: string, value: unknown): void;
    get<T = unknown>(name: string): T;
    close(): void;
    getTable(name: string, callback: (index: number) => void): void;
    setField(index: number, field: string, value: unknown): void;
    call(name: string, ...args: unknown[]): unknown[];
    getMemoryUsed(): number;
    getMemoryMax(): number | undefined;
    setMemoryMax(max: number | undefined): void;
    dumpStack(log?: (...data: unknown[]) => void): void;
    setTimeout(timeout: number | undefined): void;
    getTimeout(): number | undefined;
    isClosed(): boolean;
    getTop(): number;
    setTop(index: number): void;
    loadLibrary(library: string): void;
}

/** Minimal runtime engine contract used by this module. */
export interface LuaEngine {
    global: LuaGlobalHandle;
    doString<T = unknown>(code: string): Promise<T>;
    doFile<T = unknown>(file: string): Promise<T>;
    doStringSync<T = unknown>(code: string): T;
    doFileSync<T = unknown>(file: string): T;
}

/**
 * Lua-facing events API injected as `Events` global.
 *
 * Method names are PascalCase for Lua ergonomics (`Events:On(...)`).
 */
export interface BridgeEventsApi {
    On: (...args: unknown[]) => () => boolean;
    Off: (...args: unknown[]) => boolean;
    Emit: (...args: unknown[]) => number;
}

/**
 * Minimal Lua engine interface compatible with LuaEngine in bridge.ts.
 * Used by LuaClass to avoid circular imports.
 */
export interface LuaEngineLike {
    global: {
        set(name: string, value: unknown): void;
        get<T = unknown>(name: string): T;
    };
    doString<T = unknown>(code: string): Promise<T>;
    doStringSync<T = unknown>(code: string): T;
}

/**
 * Context passed to binding factories during LuaBridge initialization.
 * Provides access to the bridge instance for event registration, globals, etc.
 */
export interface BindingContext {
    /** The bridge instance that is being initialized. */
    bridge: LuaBridgeEventApi;
}

/** Binding factory type for installing Lua bindings. */
export type LuaBindingFactory = (ctx: BindingContext) => unknown;
