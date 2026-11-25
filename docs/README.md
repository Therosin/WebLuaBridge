---
title: WebLuaBridge
description: Embed a Lua 5.4 runtime in your TypeScript application — Deno, browser, or any WASM-capable JS runtime
---

# WebLuaBridge

**Embed Lua 5.4 in your JS app. Run scripts. Call functions. Expose APIs. Build plugin systems.**

WebLuaBridge brings Lua to JavaScript through WebAssembly via [wasmoon](https://github.com/ceifa/wasmoon). No native dependencies, no external binaries — just a runtime you control from TypeScript.

```ts
import { createLuaBridge } from "./mod.ts";

const bridge = await createLuaBridge();
const result = await bridge.execute("return 40 + 2");
console.log(result); // 42
bridge.close();
```

## Why WebLuaBridge?

| Problem | Solution |
|---|---|
| You need user scripting without `eval()` | Sandboxed Lua runtime with memory limits |
| You want plugin/mod systems | Scoped environments with isolated globals |
| You need a moddable game loop | Lifecycle hooks: `OnInit` → `Update(dt)` → `OnShutdown` |
| You want JS ↔ Lua communication | Bidirectional event bus with TypeScript types |
| You need to expose JS APIs to Lua | Decorator-based bindings + `LuaClass` builder |
| You can't install native Lua | WebAssembly — Deno, browser, any WASM runtime |

## Quick tour

**Execute Lua code**
```ts
const bridge = await createLuaBridge();
const result = await bridge.execute("return table.concat({1, 2, 3}, ', ')");
console.log(result); // "1, 2, 3"
bridge.close();
```

**Call Lua functions from JS**
```ts
await bridge.execute("function add(a, b) return a + b end");
const sum = await bridge.call<number>("add", 20, 22); // 42
```

**Pass data between JS and Lua**
```ts
await bridge.execute("config = { theme = 'dark', volume = 0.8 }");
const theme = await bridge.Get("config.theme"); // "dark"
await bridge.Set("config.volume", 0.5);
```

**One-shot execution** — create, run, cleanup:
```ts
import { runLuaCode } from "./mod.ts";
const result = await runLuaCode("return 'Hello from Lua'");
```

## Where to go next

| If you want to... | Start here |
|---|---|
| Install and run your first script | [Getting started](./getting-started.md) |
| Run Lua code in every way possible | [Guide: Running Lua code](./guides/running-lua.md) |
| Build a plugin system | [Guide: Scoped execution](./guides/scoped-execution.md) |
| Add a game/update loop | [Guide: Lifecycle loop](./guides/lifecycle.md) |
| Send events between JS and Lua | [Guide: Event system](./guides/event-system.md) |
| Expose your JS APIs to Lua | [Guide: Exposing JS APIs](./guides/exposing-js-apis.md) |
| Use in a browser | [Guide: Browser deployment](./guides/browser.md) |
| See real-world examples | [Tutorials](./tutorials/README.md) |
| Browse the full API | [API reference](./reference/api.md) |

---

**License:** LGPL-3.0 | **Author:** [Theros](https://github.com/therosin)
