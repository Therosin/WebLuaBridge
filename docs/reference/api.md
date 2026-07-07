---
title: API Reference
description: Complete reference for all WebLuaBridge exports, methods, and types
sidebar_position: 1
---

# API Reference

## Exports

Import from the module entry point:

```ts
import {
  // Functions
  createLuaBridge,
  runLuaCode,
  LuaBinder,
  LuaBinding,

  // Classes
  LuaBridge,
  LuaBindings,
  LuaClass,
  BridgeError,

  // Constants
  ErrorCodes,
} from "./mod.ts";
```

---

## createLuaBridge()

Create and initialize a new LuaBridge.

```ts
function createLuaBridge<TGlobals, TEvents>(
  globals?: TGlobals,
  options?: LuaBridgeOptions,
): Promise<LuaBridge<TGlobals, TEvents>>
```

**Type parameters:**
- `TGlobals` — shape of injected globals for typed `Get`/`Set` (default: `Record<string, unknown>`)
- `TEvents` — typed event payload map for `on`/`off`/`emit` (default: `Record<string, unknown[]>`)

**Example:**
```ts
const bridge = await createLuaBridge(
  { appName: "MyApp" },
  { functionTimeout: 2000 },
);
```

---

## runLuaCode()

Execute Lua code in a temporary bridge that closes automatically.

```ts
function runLuaCode<T>(code: string, ...args: unknown[]): Promise<T>
```

The bridge is created, executes your code, and is closed before the promise settles.

**Example:**
```ts
const result = await runLuaCode("return 1 + 2 + 3"); // 6
const greet = await runLuaCode("return 'Hello, ' .. ...", "World"); // "Hello, World"
```

---

## LuaBridge

### Constructor

```ts
new LuaBridge<TGlobals, TEvents>(globals?, options?)
```

You normally don't call this directly — use `createLuaBridge()` instead.

---

### Initialization and lifecycle

#### init()

Initialize the Lua runtime and inject bridge APIs. Safe to call multiple times.

```ts
async init(): Promise<void>
```

#### close()

Stop the loop, clean up bindings, and close the runtime. Safe to call even when not initialized.

```ts
close(): void
```

#### reopen()

Reopen a closed bridge so it can be re-initialized via `init()`. Event listeners and VFS state are preserved.

```ts
reopen(): boolean // true if bridge was in closed state
```

#### isStarted()

Check if the lifecycle mode is active (after `start()`, before `shutdown()`).

```ts
isStarted(): boolean
```

#### isMainLoopActive()

Check if the update loop is running.

```ts
isMainLoopActive(): boolean
```

---

### Running Lua code

#### execute()

Execute a Lua string asynchronously.

```ts
async execute<T>(code: string, ...args: unknown[]): Promise<T>
```

Passes additional args as Lua varargs (`...`).

**Example:**
```ts
const result = await bridge.execute("return 40 + 2"); // 42
const multi = await bridge.execute("return 1, 2, 3"); // [1, 2, 3]
```

#### executeRaw()

Execute Lua source synchronously, bypassing the execution lock.

⚠️ Use only when async execution is not possible. Can cause race conditions if async operations are in flight.

```ts
executeRaw<T>(code: string): T
```

#### call()

Call a named Lua global function directly.

```ts
async call<T>(name: string, ...args: unknown[]): Promise<T>
```

**Example:**
```ts
await bridge.execute("function add(a, b) return a + b end");
const sum = await bridge.call<number>("add", 20, 22); // 42
```

#### executeFile()

Execute a mounted Lua file.

```ts
async executeFile<T>(file: string, ...args: unknown[]): Promise<T>
```

#### executeFileRaw()

Execute a mounted Lua file synchronously, bypassing the execution lock.

⚠️ Use only when async execution is not possible. Can cause race conditions if async operations are in flight.

```ts
executeFileRaw<T>(file: string): T
```

#### loadModule()

Pre-load code as a Lua module for `require()`.

```ts
async loadModule(name: string, code: string): Promise<void>
```

#### loadCommon()

Load the `common.lua` utility library as the `"common"` module.

```ts
async loadCommon(injectGlobals?: boolean): Promise<void>
```

If `injectGlobals` is `true`, also injects `Detour`, `OnlyRunOnce`, `ReadOnly`, and `Class` into `_G`.

---

### Globals

#### Get()

Read a value from the Lua global namespace using a dot-delimited path.

```ts
Get<K extends keyof TGlobals>(path: K): Promise<TGlobals[K]>
Get<T = unknown>(path: string, defaultValue?: T): Promise<T | undefined>
```

- Flat keys (no dots) → synchronous `_G` lookup
- Dotted keys → async table traversal
- `null` from wasmoon is normalized to `undefined` for consistency
- Flat-key access is lock-free (synchronous); dotted-path access acquires the execution lock

**Example:**
```ts
const max = await bridge.Get<number>('config.limits.max');
const version = await bridge.Get('appName');
const missing = await bridge.Get('config.foo', 'fallback'); // 'fallback'
```

> **Heuristic:** `Get` distinguishes flat from dotted paths by checking for a `.` character. A key like `"my.key"` is interpreted as a nested path `_G.my.key`, not a literal key with a dot. If you need a key with a literal dot, use `execute("return _G['my.key']")` or `call`.

#### Set()

Write a value into the Lua global namespace using a dot-delimited path.

```ts
async Set(path: string, value: unknown): Promise<void>
```

- Flat keys → synchronous `_G` write
- Dotted keys → async table traversal with auto-created intermediate tables
- `LuaClass` instances are auto-detected and installed with proper metatable behavior (flat paths only)

**Example:**
```ts
await bridge.Set('x', 42);
await bridge.Set('config.limits.max', 200);
await bridge.Set('MyLib', myLuaClass); // LuaClass auto-install
```

#### GetFunction()

Get a callable handle to a Lua global function.

```ts
GetFunction<T extends (...args: any[]) => unknown>(name: string): T
```

Returns a fresh JS wrapper each call (no caching). The wrapper resolves the function name at call time, so it reflects Lua state mutations between calls.

**Example:**
```ts
const add = bridge.GetFunction<(a: number, b: number) => number>('add');
const sum = await add(40, 2); // 42
```

#### GetMethod()

Get a callable handle to a Lua method with `self` binding.

```ts
GetMethod<T extends (...args: any[]) => unknown>(path: string): T
```

For dotted paths like `"game.getPlayer"`, the parent table (`_G.game`) is resolved fresh each call and passed as the first argument (`self`), matching Lua's `obj:method(args)` calling convention. For flat names, behaves identically to `GetFunction`.

**Example:**
```ts
const getPlayer = bridge.GetMethod<(id: number) => string>('game.getPlayer');
const name = await getPlayer(42);
// calls _G.game.getPlayer(_G.game, 42)
```

#### SetFunction()

Set a JS function as a Lua global.

```ts
SetFunction<T extends (...args: any[]) => unknown>(name: string, fn: T): void
```

Thin wrapper around `Set` for documentation clarity.

#### SetMethod()

Set a JS function as a method on a Lua table.

```ts
SetMethod<T extends (...args: any[]) => unknown>(path: string, fn: T): void
```

Thin wrapper around `Set` for documentation clarity.

---

### Deprecated methods

The following methods are **deprecated** and will be removed in a future version. Use the `Get`/`Set` family instead.

| Deprecated | Replacement |
|---|---|
| `getGlobal()` | `Get()` |
| `setGlobal()` | `Set()` |
| `setGlobals()` | `Set()` (individual calls) |
| `getDeep()` | `Get()` |
| `setDeep()` | `Set()` |
| `setField()` | `Set("table.field", value)` |

---

### Events

#### on()

Register an event listener. Returns an unsubscribe function.

```ts
on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => boolean
on(event: string, handler: EventHandler): () => boolean
```

#### off()

Unregister a previously registered listener.

```ts
off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): boolean
off(event: string, handler: EventHandler): boolean
```

#### emit()

Emit an event to all registered listeners. Returns the number of handlers invoked.

```ts
emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): number
emit(event: string, ...args: unknown[]): number
```

---

### Scoped execution

#### useEnvironment()

Create an isolated execution scope backed by a JavaScript object.

```ts
async useEnvironment<TEnv extends Record<string, unknown>>(
  env: TEnv,
  options?: { files?: Record<string, string> },
): Promise<LuaExecutionContext<TEnv>>
```

Returns a scope object with `execute`, `executeFile`, `eval`, `call`, `mountFile`, `Get`, `Set`, `has`, `delete`, `keys`, `assign`, and `clear` methods.

---

### Print capture

#### onPrint()

Redirect or restore Lua `print()` output.

```ts
onPrint(callback: ((message: string) => void) | null): void
```

Pass a callback to capture Lua `print()` output. Pass `null` to restore the original `print()`.

---

### Memory management

#### getMemoryUsed()

Get current Lua memory usage in bytes. Requires `traceAllocations: true` for accurate tracking.

```ts
getMemoryUsed(): number
```

#### getMemoryMax()

Get the current memory cap, or `undefined` if no limit is set.

```ts
getMemoryMax(): number | undefined
```

#### setMemoryMax()

Set a hard memory cap. When exceeded, Lua allocations fail with OOM.

```ts
setMemoryMax(max: number | undefined): void
```

---

### Debugging

#### dumpStack()

Dump the current Lua call stack to the console (or custom logger).

```ts
dumpStack(log?: (...data: unknown[]) => void): void
```

---

### Lifecycle loop

#### start()

Start the lifecycle loop: init, run `init.lua`, call `OnInit()`, begin `Update(dt)` loop.

```ts
async start(options?: RuntimeStartOptions): Promise<void>
```

#### shutdown()

Stop the loop, call `OnShutdown()`, and close the runtime.

```ts
async shutdown(): Promise<void>
```

#### startMainLoop()

Start the update loop independently of lifecycle hooks.

```ts
startMainLoop(intervalMs?: number): boolean
```

Returns `true` if started, `false` if already running.

#### stopMainLoop()

Stop the update loop.

```ts
stopMainLoop(): boolean
```

Returns `true` if was running, `false` if wasn't.

---

### VFS

#### mountFile()

Mount a file into the virtual filesystem.

```ts
async mountFile(file: string, content: string): Promise<void>
```

---

## LuaClass

A fluent builder for creating Lua tables with metatable behaviors.

```ts
class LuaClass {
  constructor(params: { name?: string });

  // Builder methods
  method(name: string, fn: Function): this;
  value(name: string, val: unknown): this;
  callable(): this;
  readonly(): this;
  index(handler: (self: any, key: string) => unknown): this;
  newIndex(handler: (self: any, key: string, value: unknown) => void): this;

  // Installation
  install(engine: LuaEngineLike, name: string): Promise<void>;
  installSync(engine: LuaEngineLike, name: string): void;
}
```

---

## LuaBindings / @LuaBinder / @LuaBinding

```ts
// Base class for binding modules
class LuaBindings {
  constructor(ctx: BindingContext);
  ctx: BindingContext;
  install(engine: LuaEngine): Promise<void>;
  close(): void;
}

// Decorators
function LuaBinder(options: LuaBinderOptions): ClassDecorator;
function LuaBinding(options: LuaBindingOptions): MethodDecorator;
```

### LuaBinderOptions

```ts
{
  namespace?: string;    // Lua namespace (omit for _G)
  readonly?: boolean;    // Reject writes to namespace table
  callable?: boolean;    // Make namespace callable
  hooks?: {
    before?: (methodName: string, args: unknown[]) => void;
    after?: (methodName: string, result: unknown) => void;
  };
}
```

### LuaBindingOptions

```ts
{
  name?: string;                       // Name in Lua (defaults to JS name)
  args?: Array<{ name: string; type: unknown }>;  // Arg descriptors
  returnType?: unknown;                // Return type descriptor
  isMethod?: boolean;                  // First arg is self (: syntax)
  isAsync?: boolean;                   // Returns a Promise
}
```

### BindingContext

```ts
{
  bridge: LuaBridgeEventApi;  // Event-only view of the bridge
}
```

---

## BridgeError

Structured error thrown by all bridge operations.

```ts
class BridgeError extends Error {
  readonly name: "BridgeError";
  readonly code: ErrorCode;
  readonly cause?: unknown;
  constructor(message: string, code: ErrorCode, cause?: unknown);
}
```

---

## ErrorCodes

```ts
const ErrorCodes = {
  EXECUTION:    "LUA_EXECUTION_ERROR",
  SYNTAX:       "LUA_SYNTAX_ERROR",
  CALL:         "LUA_CALL_ERROR",
  FILE:         "LUA_FILE_ERROR",
  MODULE:       "LUA_MODULE_ERROR",
  ENVIRONMENT:  "LUA_ENVIRONMENT_ERROR",
  SET_GLOBAL:   "LUA_SET_GLOBAL_ERROR",
  GET_GLOBAL:   "LUA_GET_GLOBAL_ERROR",
  MEMORY:       "LUA_MEMORY_ERROR",
  NOT_INITIALIZED: "BRIDGE_NOT_INITIALIZED",
  START:        "BRIDGE_START_ERROR",
  SHUTDOWN:     "BRIDGE_SHUTDOWN_ERROR",
  CLOSE:        "BRIDGE_CLOSE_ERROR",
  CANCELLED:    "OPERATION_CANCELLED",
} as const;
```

---

## Types

### LuaBridgeOptions

```ts
{
  // Runtime options
  openStandardLibs?: boolean;        // default: true
  injectObjects?: boolean;           // default: true
  enableProxy?: boolean;             // default: true
  traceAllocations?: boolean;        // default: false
  functionTimeout?: number;          // default: 1000

  // Bridge options
  mainLoopIntervalMs?: number;       // default: 16
  wasmUri?: string;
  bindings?: LuaBindingFactory[];
  files?: Record<string, string>;
}
```

### LuaBridgeGlobals

```ts
Record<string, unknown>
```

### LuaBridgeEventMap

```ts
Record<string, unknown[]>
```

### LuaExecutionContext

```ts
{
  readonly environment: TEnv;
  execute<T>(code: string, ...args: unknown[]): Promise<T>;
  executeFile<T>(file: string, ...args: unknown[]): Promise<T>;
  mountFile(path: string, content: string): Promise<void>;
  eval<T>(expression: string): Promise<T>;
  call<T>(name: string, ...args: unknown[]): Promise<T>;
  Get<T>(key: string): T;
  Set(key: string, value: unknown): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  keys(): string[];
  assign(pairs: Record<string, unknown>): void;
  clear(): void;
}
```
