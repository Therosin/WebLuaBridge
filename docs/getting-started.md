# Getting Started

## What is WebLuaBridge?

WebLuaBridge lets you embed a Lua runtime inside your TypeScript/JavaScript application. You can execute Lua scripts, call Lua functions from JS, expose JS APIs to Lua, and build plugin/modding systems — all without a native Lua installation. It runs Lua in WebAssembly via [wasmoon](https://github.com/ceifa/wasmoon).

## Installation

Import directly from GitHub (Deno):

```ts
import { createLuaBridge } from "https://raw.githubusercontent.com/Therosin/WebLuaBridge/develop/mod.ts";
```

For production, pin a specific commit or tag:

```ts
import { createLuaBridge } from "https://raw.githubusercontent.com/Therosin/WebLuaBridge/v0.1.0/mod.ts";
```

## Your first bridge

```ts
import { createLuaBridge } from "./mod.ts";

const bridge = await createLuaBridge();
try {
  const result = await bridge.execute("return 40 + 2");
  console.log(result); // 42
} finally {
  bridge.close();
}
```

`createLuaBridge()` initializes a Lua runtime and returns a bridge instance. Always call `bridge.close()` when you're done to free resources.

## One-shot execution

If you only need to run Lua once and don't need the bridge afterwards, use `runLuaCode()`:

```ts
import { runLuaCode } from "./mod.ts";

const result = await runLuaCode("return 'hello from Lua'");
console.log(result); // "hello from Lua"
```

`runLuaCode()` creates a temporary bridge, executes your code, and cleans up automatically.

## Passing globals

You can inject values into Lua's global scope:

```ts
const bridge = await createLuaBridge({ appName: "MyApp", version: 2 });
// Lua can now access:  _G.appName  and  _G.version
```

## Next steps

- [Execution](./execution.md) — all the ways to run Lua code
- [Events](./events.md) — JS↔Lua communication
- [Bindings](./bindings.md) — exposing JS APIs to Lua with decorators
