import LuaBridge, { createLuaBridge, runLuaCode } from './src/lua/bridge.ts';
import { LuaClass } from './src/lua/lua_class.ts';
import { LuaBindings } from './src/lua/bindings.ts';
export type {
    BindingContext,
    EventHandler,
    LuaBindingFactory,
    LuaBridgeEventApi,
    LuaBridgeEventMap,
    LuaBridgeGlobals,
    LuaBridgeOptions,
    LuaEngineLike,
    LuaExecutionContext,
    LuaRuntimeOptions,
    RuntimeStartOptions,
} from './src/lua/types.ts';
export type {
    LuaBinderOptions,
    LuaBindingDocs,
    LuaBindingMethodDocs,
    LuaBindingOptions,
    LuaBindingRole,
    LuaBindingClass,
} from './src/lua/bindings.ts';

export { createLuaBridge, LuaBindings, LuaClass, runLuaCode };
export { bindingDocs, LuaBinder, LuaBinding, LuaCall, LuaIndex, LuaNewIndex } from './src/lua/bindings.ts';
export { BridgeError, ErrorCodes } from './src/lua/errors.ts';
export type { ErrorCode } from './src/lua/errors.ts';

export { default as globalBindings, type GlobalBindings } from './src/bindings/global.ts';
export { default as jsonBindings, type JsonBindings } from './src/bindings/json.ts';
export { default as regexBindings, type RegexBindings } from './src/bindings/regex.ts';
export { default as timersBindings, type TimerBindings } from './src/bindings/timers.ts';

export default LuaBridge;
