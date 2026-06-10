# WebLuaBridge Documentation

Welcome! This folder contains everything you need to use WebLuaBridge effectively.

---

## Reading order

If you're new, start here:

1. **[Getting started](./getting-started.md)** — install, create a bridge, run your first Lua script
2. **[Execution](./execution.md)** — all the ways to run Lua code
3. **[Events](./events.md)** — JS↔Lua event bus

Then explore the specific systems you need:

| Topic | When to read |
|---|---|
| [Lifecycle](./lifecycle.md) | You need a game loop or init/shutdown hooks |
| [Environments](./environments.md) | You want sandboxed, isolated Lua execution |
| [Globals](./globals.md) | You need to share structured state between JS and Lua |
| [Bindings](./bindings.md) | You want to expose JS APIs to Lua with decorators |
| [Common Lua helpers](./common-lua.md) | You need `Detour`, `OnlyRunOnce`, `ReadOnly`, or `Class` in Lua |
| [Debugging](./debugging.md) | You want to capture Lua `print()` output, inspect memory, dump the stack |
| [Browser](./browser.md) | You want to run Lua in a browser |

---

## Quick reference

```ts
// Import
import { createLuaBridge, runLuaCode } from "mod.ts";

// Create and run
const bridge = await createLuaBridge();
const result = await bridge.execute("return 40 + 2");
bridge.close();

// One-shot
const result = await runLuaCode("return 1 + 2");
```

---

## Examples

See [`examples/`](../examples/) for runnable scripts demonstrating each feature.
