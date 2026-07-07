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
 * @module EnvironmentService
 *
 * Scoped execution contexts (environments) for LuaBridge.
 *
 * Each environment is a JS object that acts as a priority namespace
 * for Lua variable resolution. Reads check the environment first,
 * then fall back to `_G`. Writes always target the environment.
 *
 * This service is used by `bridge.useEnvironment()` and provides
 * the `LuaExecutionContext` returned to callers.
 */

import { BridgeError, ErrorCodes } from './errors.ts';
import { toLuaLongString, toBridgeError, isObject } from './utils.ts';
import type { LuaEngine, LuaExecutionContext } from './types.ts';

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

export interface EnvironmentDeps {
    /** Get the current Lua engine. */
    getLua: () => LuaEngine;
    /** Execute code while already holding the execution lock. */
    executeInCurrentLock: <T>(code: string, ...args: unknown[]) => Promise<T>;
    /** Serialize ops through the execution queue. */
    withExecutionLock: <T>(operation: () => Promise<T>) => Promise<T>;
    /**
     * Mount a file into the Lua filesystem.
     * Should come from VfsRegistry or factory.
     */
    mountFile?: (path: string, content: string) => Promise<void>;
    /**
     * Returns the events API identity object (or null).
     * Used to detect and strip Lua's implicit `self` argument
     * when events methods are called with `:` syntax.
     */
    getEventsApiIdentity?: () => unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENV_GLOBAL_NAME = '__bridge_env';

// ---------------------------------------------------------------------------
// EnvironmentService
// ---------------------------------------------------------------------------

export class EnvironmentService {
    constructor(private readonly deps: EnvironmentDeps) {}

    /**
     * Build a scoped execution proxy backed by a custom environment object.
     */
    async useEnvironment<TEnv extends Record<string, unknown>>(
        env: TEnv,
        options?: { files?: Record<string, string> },
    ): Promise<LuaExecutionContext<TEnv>> {
        try {
            if (!isObject(env)) {
                throw new Error('Environment must be an object');
            }

            // Mount environment-scoped files
            if (options?.files && this.deps.mountFile) {
                for (const [path, content] of Object.entries(options.files)) {
                    await this.deps.mountFile(path, content);
                }
            }

            const withEnvironment = async <T>(callback: () => Promise<T>): Promise<T> => {
                return await this.deps.withExecutionLock(async () => {
                    const lua = this.deps.getLua();
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

            const normalizeArgs = (args: unknown[]): unknown[] => {
                const apiId = this.deps.getEventsApiIdentity?.();
                if (apiId !== undefined && args.length > 0 && args[0] === apiId) {
                    return args.slice(1);
                }
                if (
                    args.length > 1 && typeof args[0] !== 'string' &&
                    typeof args[1] === 'string'
                ) {
                    return args.slice(1);
                }
                return args;
            };

            return {
                environment: env,

                execute: async <T = unknown>(code: string, ...args: unknown[]): Promise<T> => {
                    const wrappedCode = `${scopeCodePrefix}
local __chunk = assert(load(${toLuaLongString(code)}, nil, 't', __scope))
return __chunk(...)
`;
                    return await withEnvironment(
                        () => this.deps.executeInCurrentLock<T>(wrappedCode, ...normalizeArgs(args)),
                    );
                },

                executeFile: async <T = unknown>(
                    file: string,
                    ...args: unknown[]
                ): Promise<T> => {
                    const wrappedCode = `${scopeCodePrefix}
local __chunk = assert(loadfile(${toLuaLongString(file)}, 't', __scope))
return __chunk(...)
`;
                    return await withEnvironment(
                        () => this.deps.executeInCurrentLock<T>(wrappedCode, ...normalizeArgs(args)),
                    );
                },

                mountFile: async (path: string, content: string): Promise<void> => {
                    if (!this.deps.mountFile) {
                        throw new BridgeError(
                            'mountFile not available: no VfsRegistry provided',
                            ErrorCodes.FILE,
                        );
                    }
                    await this.deps.mountFile(path, content);
                },

                // ── Environment introspection & manipulation ──

                Get: <T = unknown>(key: string): T =>
                    (env as Record<string, unknown>)[key] as T,
                Set: (key: string, value: unknown): void => {
                    (env as Record<string, unknown>)[key] = value;
                },
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
                    const wrappedCode = `${scopeCodePrefix}
local __chunk = assert(load(
    ${toLuaLongString(`return (${expression})`)},
    nil,
    't',
    __scope
))
return __chunk()
`;
                    return await withEnvironment(
                        () => this.deps.executeInCurrentLock<T>(wrappedCode),
                    );
                },

                call: async <T = unknown>(
                    name: string,
                    ...args: unknown[]
                ): Promise<T> => {
                    // JS functions on the env object are not callable through the
                    // scope metatable — call them directly from JS
                    const resolved = (env as Record<string, unknown>)[name];
                    if (typeof resolved === 'function') {
                        return (resolved as (...args: unknown[]) => T)(...normalizeArgs(args));
                    }

                    // Validate path against injection — only dot-delimited identifiers
                    const SAFE_PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
                    if (!SAFE_PATH.test(name)) {
                        throw new BridgeError(
                            `Invalid function path: ${name}. Only dot-delimited identifier paths are supported.`,
                            ErrorCodes.CALL,
                        );
                    }

                    const wrappedCode = `${scopeCodePrefix}
local __fn = ${name}
if type(__fn) ~= "function" then
    error("attempt to call a non-function value (" .. ${toLuaLongString(name)} .. ")", 0)
end
return __fn(...)
`;
                    return await withEnvironment(
                        () => this.deps.executeInCurrentLock<T>(wrappedCode, ...normalizeArgs(args)),
                    );
                },
            };
        } catch (error) {
            throw toBridgeError('Failed to use environment', error, ErrorCodes.ENVIRONMENT);
        }
    }
}
