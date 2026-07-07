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

import type { LuaRuntimeOptions } from './types.ts';

/** Default Wasmoon runtime options used when no overrides are provided. */
export const DEFAULT_RUNTIME_OPTIONS = {
    openStandardLibs: true,
    injectObjects: true,
    enableProxy: true,
    traceAllocations: false,
    functionTimeout: 1000,
} as const;

/** Error used when runtime-dependent operations are invoked before `init()`. */
export const NOT_INITIALIZED_ERROR = 'LuaBridge not initialized';
/** Fallback error message for unknown throwable values. */
export const UNKNOWN_ERROR = 'Unknown error';
/** Optional lifecycle boot file checked during `start()`. */
export const INIT_FILE = 'init.lua';
/** Default JS timer interval used for the update loop. */
export const DEFAULT_TICK_INTERVAL_MS = 16;
/** Lua snippet that calls `_G.OnInit(...)` when defined. */
export const CALL_ON_INIT_CODE = "local fn = _G.OnInit; if type(fn) == 'function' then return fn(...) end";
/** Lua snippet that calls `_G.Update(dt)` when defined. */
export const CALL_UPDATE_CODE = "local fn = _G.Update; if type(fn) == 'function' then return fn(...) end";
/** Lua snippet that calls `_G.OnShutdown(...)` when defined. */
export const CALL_ON_SHUTDOWN_CODE = "local fn = _G.OnShutdown; if type(fn) == 'function' then return fn(...) end";
/** Legacy argument global used by `executeFile` compatibility mode. */
export const COMPAT_ARGS_GLOBAL = 'args';

import type { ErrorCode } from './errors.ts';
import { BridgeError, ErrorCodes } from './errors.ts';

/** Convert unknown thrown values into stable user-facing error messages. */
export const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return UNKNOWN_ERROR;
};

/**
 * Detect whether a Lua error message is a syntax/parse error vs a runtime error.
 *
 * Lua 5.4 syntax errors have characteristic tokens like `expected near`.
 * Runtime errors (from `error()` calls, nil-index, etc.) do not.
 * Both are prefixed with `[string "..."]` by wasmoon, so we must inspect the
 * *content* of the message, not just the prefix.
 */
const SYNTAX_PATTERNS = [
    /\bexpected near\b/,
    /\bunexpected symbol\b/,
    /\bmalformed number\b/,
    /\binvalid escape sequence\b/,
];

function isLuaSyntaxError(message: string): boolean {
    return SYNTAX_PATTERNS.some((re) => re.test(message));
}

function detectCode(contextCode: ErrorCode, error: unknown): ErrorCode {
    if (contextCode === ErrorCodes.EXECUTION) {
        const msg = getErrorMessage(error);
        if (isLuaSyntaxError(msg)) {
            return ErrorCodes.SYNTAX;
        }
    }
    return contextCode;
}

/** Wraps an error into a structured BridgeError with a code. */
export const toBridgeError = (context: string, error: unknown, code: ErrorCode = ErrorCodes.EXECUTION): BridgeError => {
    // If error is already a BridgeError, preserve its code — just enrich the message
    if (error instanceof BridgeError) {
        return new BridgeError(`${context}: ${error.message}`, error.code, error);
    }
    const resolvedCode = detectCode(code, error);
    return new BridgeError(`${context}: ${getErrorMessage(error)}`, resolvedCode, error);
};

/** Narrow unknown values to plain object records. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Serialize arbitrary string content as a Lua long-bracket literal.
 *
 * Uses dynamic `=` padding to avoid accidental closing delimiters inside content.
 */
export const toLuaLongString = (value: string): string => {
    let equals = '';
    while (value.includes(`]${equals}]`)) {
        equals += '=';
    }
    return `[${equals}[${value}]${equals}]`;
};

/** Validate and normalize runtime options before creating the Wasmoon engine. */
export const normalizeRuntimeOptions = (options: Partial<LuaRuntimeOptions> = {}): LuaRuntimeOptions => {
    const runtimeOptions: LuaRuntimeOptions = { ...DEFAULT_RUNTIME_OPTIONS, ...options };
    if (runtimeOptions.functionTimeout != null) {
        if (typeof runtimeOptions.functionTimeout !== 'number' || runtimeOptions.functionTimeout < 0) {
            throw new Error('functionTimeout must be a non-negative number or undefined');
        }
    }
    return runtimeOptions;
};

/** Validate configured main-loop interval and return an explicit value. */
export const normalizeMainLoopInterval = (value: number | undefined): number => {
    if (value == null) {
        return DEFAULT_TICK_INTERVAL_MS;
    }
    if (typeof value !== 'number' || value <= 0) {
        throw new Error('mainLoopIntervalMs must be a positive number or undefined');
    }
    return value;
};

/**
 * Wrap Lua source in a callable `main(...)` function that pulls bridge arguments from `_G`.
 *
 * This preserves support for passing JS arguments into arbitrary code snippets.
 */
export const luaWrap = (code: string, argsGlobalName: string = COMPAT_ARGS_GLOBAL): string => {
    const argsKeyLiteral = toLuaLongString(argsGlobalName);
    return `
        local args = rawget(_G, ${argsKeyLiteral}) or {}
        rawset(_G, ${argsKeyLiteral}, nil)
        local function main(...)
            ${code}
        end
        return table.pack(main(table.unpack(args)))
    `;
};

/**
 * Parse the result of Lua's `table.pack(...)` back into JS values.
 *
 * - `{ n = 0 }` (no returns) → `undefined`
 * - `{ [1] = val, n = 1 }` (single return) → `val`
 * - `{ [1] = a, [2] = b, n = 2 }` (multi return) → `[a, b]`
 */
export function unwrapTablePack(raw: unknown): unknown {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const obj = raw as Record<string, unknown>;
        const n = obj['n'];
        if (typeof n === 'number') {
            if (n === 0) return undefined;
            if (n === 1) return obj['1'];
            const results: unknown[] = [];
            for (let i = 1; i <= n; i++) {
                results.push(obj[String(i)]);
            }
            return results;
        }
    }
    return raw;
}

/**
 * Wrap arbitrary Lua code so that all return values are captured into
 * a single table via `table.pack()`. The caller should then call
 * `unwrapTablePack` on the result.
 */
export function wrapForMultiReturn(code: string): string {
    return `
        do
            local function __bridge_exec_fn(...)
                ${code}
            end
            return table.pack(__bridge_exec_fn())
        end
    `;
}
