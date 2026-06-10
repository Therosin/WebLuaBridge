import LuaBridge, { createLuaBridge, runLuaCode, LuaClass, LuaBindings } from './src/lua_bridge.ts';
export type {
    EventHandler,
    LuaBridgeEventApi,
    LuaBridgeEventMap,
    LuaBridgeGlobals,
    LuaBridgeOptions,
    LuaExecutionContext,
    LuaRuntimeOptions,
    RuntimeStartOptions,
    BindingContext,
    LuaBindingFactory,
    LuaEngineLike,
} from './src/lua/types.ts';
export type {
    LuaBinderOptions,
    LuaBindingOptions,
} from './src/lua/bindings.ts';

export { createLuaBridge, runLuaCode, LuaClass, LuaBindings };
export { LuaBinder, LuaBinding } from './src/lua/bindings.ts';
export default LuaBridge;

// Re-export wasmoon types for consumer convenience
export {
    LuaMultiReturn,
    LuaTimeoutError,
    LuaType,
    LuaReturn,
    LuaLibraries,
    LuaEventCodes,
    LuaEventMasks,
} from 'npm:wasmoon@1.16.0';
