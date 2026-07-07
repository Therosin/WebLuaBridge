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
 * Error codes for every bridge operation that can fail.
 *
 * Consumers can check `error.code` instead of parsing message strings:
 *
 * ```ts
 * try {
 *   await bridge.execute(code);
 * } catch (err) {
 *   if (err instanceof BridgeError && err.code === 'LUA_SYNTAX_ERROR') {
 *     // Show syntax help to the user
 *   } else if (err.code === 'LUA_EXECUTION_ERROR') {
 *     // Runtime error — show the Lua traceback
 *   }
 * }
 * ```
 */
export const ErrorCodes = {
    /** Lua code threw a runtime error (error()) or execution failed. */
    EXECUTION: 'LUA_EXECUTION_ERROR',
    /** Lua code has a syntax error (parse failure). */
    SYNTAX: 'LUA_SYNTAX_ERROR',
    /** bridge.call() failed — function not found or invocation error. */
    CALL: 'LUA_CALL_ERROR',
    /** luafile execution failed — missing file or runtime error. */
    FILE: 'LUA_FILE_ERROR',
    /** loadModule() failed. */
    MODULE: 'LUA_MODULE_ERROR',
    /** useEnvironment() failed. */
    ENVIRONMENT: 'LUA_ENVIRONMENT_ERROR',
    /** setGlobal() / setGlobals() failed. */
    SET_GLOBAL: 'LUA_SET_GLOBAL_ERROR',
    /** getGlobal() failed. */
    GET_GLOBAL: 'LUA_GET_GLOBAL_ERROR',
    /** Memory limit or memory inspection failed. */
    MEMORY: 'LUA_MEMORY_ERROR',
    /** Operation requires init() but bridge is not initialized. */
    NOT_INITIALIZED: 'BRIDGE_NOT_INITIALIZED',
    /** Lifecycle start() failed. */
    START: 'BRIDGE_START_ERROR',
    /** Lifecycle shutdown() failed. */
    SHUTDOWN: 'BRIDGE_SHUTDOWN_ERROR',
    /** close() failed. */
    CLOSE: 'BRIDGE_CLOSE_ERROR',
    /** Operation cancelled via AbortSignal. */
    CANCELLED: 'OPERATION_CANCELLED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Structured error thrown by all bridge operations.
 *
 * Carries a `.code` property for programmatic discrimination
 * in addition to the human-readable `.message`.
 */
export class BridgeError extends Error {
    override readonly name = 'BridgeError';
    readonly code: ErrorCode;
    override readonly cause?: unknown;

    constructor(message: string, code: ErrorCode, cause?: unknown) {
        super(message);
        this.code = code;
        this.cause = cause;
        // Fix prototype chain for instanceof checks
        Object.setPrototypeOf(this, BridgeError.prototype);
    }
}
