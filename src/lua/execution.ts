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

/**
 * @module ExecutionService
 *
 * Execution, globals, print capture, and memory operations for LuaBridge.
 *
 * This service is the extracted "how" from the monolithic bridge.ts —
 * it receives its dependencies via constructor (dependency injection)
 * so the bridge can compose it without inheriting from it.
 */

import type { LuaEngine } from './types.ts';
import { ErrorCodes } from './errors.ts';
import { COMMON_LUA_SOURCE } from '../common_lua_content.ts';
import {
    toLuaLongString,
    toBridgeError,
    luaWrap,
    unwrapTablePack,
    wrapForMultiReturn,
    COMPAT_ARGS_GLOBAL,
} from './utils.ts';
import { LuaClass } from './lua_class.ts';

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

export interface ExecutionDeps {
    /** Get the current Lua engine (throws if not initialized). */
    getLua: () => LuaEngine;
    /** Serialize async operations through the execution queue. */
    withExecutionLock: <T>(operation: () => Promise<T>) => Promise<T>;
    /** Generate a unique key name for temporary globals. */
    nextArgsKey: () => string;
    /**
     * Mutable reference to the stored original Lua print function.
     * The bridge shares this reference so state survives across
     * close/reset/init cycles.
     */
    originalPrint: { current: unknown };
}

// ---------------------------------------------------------------------------
// ExecutionService
// ---------------------------------------------------------------------------

export class ExecutionService {
    constructor(private readonly deps: ExecutionDeps) {}

    // ── Core execution ──────────────────────────────────────────────────

    /**
     * Execute Lua source code in the current runtime.
     */
    async execute<T = unknown>(code: string, ...args: unknown[]): Promise<T> {
        this.deps.getLua();
        return await this.deps.withExecutionLock(async () => {
            return await this.executeInCurrentLock<T>(code, ...args);
        });
    }

    /**
     * Execute code while already holding the execution lock.
     * Public so EnvironmentService can call it while already locked.
     */
    async executeInCurrentLock<T = unknown>(code: string, ...args: unknown[]): Promise<T> {
        try {
            const lua = this.deps.getLua();
            let finalCode: string;

            if (args.length > 0) {
                const argsGlobalName = this.deps.nextArgsKey();
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
            throw toBridgeError('Failed to execute code', error, ErrorCodes.EXECUTION);
        }
    }

    /**
     * Execute Lua source synchronously, bypassing the execution lock.
     *
     * ⚠️ Use only when async execution is not possible. Can cause race conditions
     * if async operations are in flight.
     */
    executeRaw<T = unknown>(code: string): T {
        try {
            return this.deps.getLua().doStringSync<T>(code);
        } catch (error) {
            throw toBridgeError('Failed to execute sync', error, ErrorCodes.EXECUTION);
        }
    }

    /**
     * Execute a mounted Lua file.
     */
    async executeFile<T = unknown>(file: string, ...args: unknown[]): Promise<T> {
        const lua = this.deps.getLua();
        return await this.deps.withExecutionLock(async () => {
            try {
                return await this.withScopedCompatArgs(args, async () => {
                    const wrapped = wrapForMultiReturn(`return dofile(${toLuaLongString(file)})`);
                    const raw = await lua.doString<Record<string, unknown>>(wrapped);
                    return unwrapTablePack(raw) as unknown as T;
                });
            } catch (error) {
                throw toBridgeError('Failed to execute file', error, ErrorCodes.FILE);
            }
        });
    }

    /**
     * Execute a mounted Lua file synchronously, bypassing the execution lock.
     *
     * ⚠️ Use only when async execution is not possible. Can cause race conditions
     * if async operations are in flight.
     */
    executeFileRaw<T = unknown>(file: string): T {
        try {
            return this.deps.getLua().doFileSync<T>(file);
        } catch (error) {
            throw toBridgeError('Failed to execute file sync', error, ErrorCodes.FILE);
        }
    }

    // ── Call ────────────────────────────────────────────────────────────

    /**
     * Call a Lua global function directly from JS.
     */
    async call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
        const lua = this.deps.getLua();
        return await this.deps.withExecutionLock(() => {
            try {
                if (typeof name !== 'string' || name.length === 0) {
                    return Promise.reject(new Error('Function name must be a non-empty string'));
                }
                const result = lua.global.call(name, ...args);
                if (result && result.length > 0) {
                    return Promise.resolve((result.length === 1 ? result[0] : result) as T);
                }
                return Promise.resolve(undefined as unknown as T);
            } catch (error) {
                return Promise.reject(toBridgeError(`Failed to call '${name}'`, error, ErrorCodes.CALL));
            }
        });
    }

    // ── Module loading ──────────────────────────────────────────────────

    /**
     * Load a module into `package.loaded[moduleName]`.
     */
    async loadModule(name: string, code: string): Promise<void> {
        const lua = this.deps.getLua();
        return await this.deps.withExecutionLock(async () => {
            try {
                if (typeof name !== 'string' || name.length === 0) {
                    throw new Error('Module name must be a non-empty string');
                }
                if (typeof code !== 'string') {
                    throw new Error('Module code must be a string');
                }

                const moduleNameKey = `__lua_bridge_module_name_${this.deps.nextArgsKey()}`;
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
                throw toBridgeError('Failed to load module', error, ErrorCodes.MODULE);
            }
        });
    }

    /**
     * Load the common.lua library.
     */
    async loadCommon(injectGlobals: boolean = false): Promise<void> {
        await this.loadModule('common', COMMON_LUA_SOURCE);
        if (injectGlobals) {
            await this.execute(`
                local _common = require("common")
                Detour = _common.Detour
                OnlyRunOnce = _common.OnlyRunOnce
                ReadOnly = _common.ReadOnly
                Class = _common.Class
            `);
        }
    }

    // ── Globals ─────────────────────────────────────────────────────────

    /**
     * Set a global value in the Lua runtime.
     */
    setGlobal(name: string, value: unknown): void {
        if (value instanceof LuaClass) {
            value.installSync(this.deps.getLua(), name);
            return;
        }
        try {
            this.deps.getLua().global.set(name, value);
        } catch (error) {
            throw toBridgeError('Failed to set global', error, ErrorCodes.SET_GLOBAL);
        }
    }

    /**
     * Read a global value from the Lua runtime.
     */
    getGlobal<T = unknown>(name: string): T {
        try {
            return this.deps.getLua().global.get<T>(name);
        } catch (error) {
            throw toBridgeError('Failed to get global', error, ErrorCodes.GET_GLOBAL);
        }
    }

    /**
     * Set multiple globals at once.
     */
    setGlobals(values: Record<string, unknown>): void {
        for (const [name, value] of Object.entries(values)) {
            this.setGlobal(name, value);
        }
    }

    /**
     * Read a deeply nested global using dot-delimited path.
     */
    async getDeep<T = unknown>(path: string, defaultValue?: T): Promise<T | undefined> {
        this.deps.getLua();
        const safePath = toLuaLongString(path);
        return await this.deps.withExecutionLock(async () => {
            return await this.executeInCurrentLock<T | undefined>(
                `
                    local parts = {}
                    for part in string.gmatch(${safePath}, "[^.]+") do
                        parts[#parts + 1] = part
                    end
                    if #parts == 0 then error("empty path") end
                    local val = _G
                    for i = 1, #parts do
                        val = val[parts[i]]
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
     * Write a deeply nested global using dot-delimited path.
     */
    async setDeep(path: string, value: unknown): Promise<void> {
        this.deps.getLua();
        return await this.deps.withExecutionLock(async () => {
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
                throw toBridgeError(`Failed to set path '${path}'`, error, ErrorCodes.SET_GLOBAL);
            }
        });
    }

    /**
     * Set a field on a global Lua table.
     */
    setField(tableName: string, field: string, value: unknown): void {
        try {
            const lua = this.deps.getLua();
            lua.global.getTable(tableName, (index: number) => {
                lua.global.setField(index, field, value);
            });
        } catch (error) {
            throw toBridgeError('Failed to set field', error, ErrorCodes.SET_GLOBAL);
        }
    }

    // ── Print capture ───────────────────────────────────────────────────

    /**
     * Capture or release Lua print() output.
     */
    onPrint(callback: ((message: string) => void) | null): void {
        const lua = this.deps.getLua();
        if (callback) {
            if (this.deps.originalPrint.current === null) {
                this.deps.originalPrint.current = lua.global.get('print');
            }
            lua.global.set('print', (...args: unknown[]) => {
                const formatted = args.map((a) => String(a)).join('\t');
                callback(formatted);
            });
        } else {
            if (this.deps.originalPrint.current !== null) {
                lua.global.set('print', this.deps.originalPrint.current);
                this.deps.originalPrint.current = null;
            }
        }
    }

    // ── Memory ──────────────────────────────────────────────────────────

    /** Get current Lua memory usage. */
    getMemoryUsed(): number {
        try {
            return this.deps.getLua().global.getMemoryUsed();
        } catch (error) {
            throw toBridgeError('Failed to get memory usage', error, ErrorCodes.MEMORY);
        }
    }

    /** Get memory cap. */
    getMemoryMax(): number | undefined {
        try {
            return this.deps.getLua().global.getMemoryMax();
        } catch (error) {
            throw toBridgeError('Failed to get memory max', error, ErrorCodes.MEMORY);
        }
    }

    /** Set memory cap. */
    setMemoryMax(max: number | undefined): void {
        try {
            this.deps.getLua().global.setMemoryMax(max);
        } catch (error) {
            throw toBridgeError('Failed to set memory max', error, ErrorCodes.MEMORY);
        }
    }

    /** Dump Lua stack. */
    dumpStack(log?: (...data: unknown[]) => void): void {
        try {
            this.deps.getLua().global.dumpStack(log);
        } catch (error) {
            throw toBridgeError('Failed to dump stack', error, ErrorCodes.MEMORY);
        }
    }

    // ── Private helpers ─────────────────────────────────────────────────

    /** Generate a unique key for temporary globals. */
    private nextArgsKey(): string {
        return this.deps.nextArgsKey();
    }

    /**
     * Set compatibility `args` global only for duration of a file execution.
     */
    private async withScopedCompatArgs<T>(
        args: unknown[],
        operation: () => Promise<T>,
    ): Promise<T> {
        if (!args || args.length === 0) {
            return await operation();
        }

        const lua = this.deps.getLua();
        const previousArgs = lua.global.get(COMPAT_ARGS_GLOBAL);
        lua.global.set(COMPAT_ARGS_GLOBAL, args);
        try {
            return await operation();
        } finally {
            lua.global.set(COMPAT_ARGS_GLOBAL, previousArgs);
        }
    }
}
