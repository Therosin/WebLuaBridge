import LuaBridge, { createLuaBridge, runLuaCode } from './src/lua_bridge.ts';
export type {
    EventHandler,
    LuaBridgeEventApi,
    LuaBridgeEventMap,
    LuaBridgeGlobals,
    LuaBridgeOptions,
    LuaExecutionContext,
    LuaRuntimeOptions,
    RuntimeStartOptions,
} from './src/lua_bridge.ts';

export { createLuaBridge, runLuaCode };
export default LuaBridge;
