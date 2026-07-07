/**
 * Browser/Node entry point for the self-contained ESM bundle.
 *
 * The WASM binary is inlined at build time via `scripts/build_bundle.ts`.
 * The generated `browser/wasm_inline.ts` is created during build and cleaned up after.
 *
 * Usage (Node / browser via bundler):
 *   import { createLuaBridge } from './webluabridge.bundle.js';
 *   const bridge = await createLuaBridge();
 *   const result = await bridge.execute('return 40 + 2');
 *   console.log(result); // 42
 */
import LuaBridge, { createLuaBridge as _createLuaBridge, type runLuaCode as _runLuaCode } from '../src/lua/bridge.ts';
import type { LuaBridgeOptions } from '../src/lua/types.ts';
import { WASM_URI } from './wasm_inline.ts';

export type {
    EventHandler,
    LuaBridgeEventApi,
    LuaBridgeEventMap,
    LuaBridgeGlobals,
    LuaExecutionContext,
    LuaRuntimeOptions,
    RuntimeStartOptions,
} from '../src/lua/types.ts';

/**
 * Create a LuaBridge with the inlined WASM runtime.
 * Automatically passes the self-contained WASM data URI.
 */
export function createLuaBridge<
    TGlobals extends Record<string, unknown> = Record<string, unknown>,
    TEvents extends Record<string, unknown[]> = Record<string, unknown[]>,
>(
    globals?: TGlobals,
    options?: LuaBridgeOptions,
): Promise<LuaBridge<TGlobals, TEvents>> {
    return _createLuaBridge(globals, { ...options, wasmUri: WASM_URI });
}

/**
 * Execute Lua code in a temporary bridge with inlined WASM.
 */
export async function runLuaCode<T = unknown>(code: string, ...args: unknown[]): Promise<T> {
    const bridge = await createLuaBridge();
    try {
        return await bridge.execute<T>(code, ...args);
    } finally {
        bridge.close();
    }
}

export { LuaBridge };
export default LuaBridge;
