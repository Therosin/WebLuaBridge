/**
 * Restore the Wasmoon Lua stack after APIs that convert return values to JS.
 *
 * Wasmoon 1.16.0 leaves values from doString/doStringSync and global.call on
 * the engine stack. Keep this compatibility guard at the engine boundary so
 * callers do not need to manage Wasmoon's internal stack themselves.
 */

import type { LuaEngine } from "./types.ts";

/** Install a bridge-local workaround for Wasmoon return-value stack leaks. */
export function guardWasmoonReturnStack(lua: LuaEngine): LuaEngine {
    const { global } = lua;
    if (
        typeof global.getTop !== "function" ||
        typeof global.setTop !== "function"
    ) {
        return lua;
    }

    const withStackRestore = <T>(operation: () => T): T => {
        const top = global.getTop();
        try {
            return operation();
        } finally {
            global.setTop(top);
        }
    };

    const withAsyncStackRestore = async <T>(
        operation: () => Promise<T>,
    ): Promise<T> => {
        const top = global.getTop();
        try {
            return await operation();
        } finally {
            global.setTop(top);
        }
    };

    const doString = lua.doString.bind(lua);
    lua.doString = <T = unknown>(code: string): Promise<T> =>
        withAsyncStackRestore(() => doString<T>(code));

    const doFile = lua.doFile.bind(lua);
    lua.doFile = <T = unknown>(file: string): Promise<T> =>
        withAsyncStackRestore(() => doFile<T>(file));

    const doStringSync = lua.doStringSync.bind(lua);
    lua.doStringSync = <T = unknown>(code: string): T =>
        withStackRestore(() => doStringSync<T>(code));

    const doFileSync = lua.doFileSync.bind(lua);
    lua.doFileSync = <T = unknown>(file: string): T =>
        withStackRestore(() => doFileSync<T>(file));

    const call = global.call.bind(global);
    global.call = (...args: Parameters<typeof call>): ReturnType<typeof call> =>
        withStackRestore(() => call(...args));

    return lua;
}
