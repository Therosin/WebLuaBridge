---
title: Configuration
description: All configuration options for LuaBridge with defaults and descriptions
sidebar_position: 2
---

# Configuration

## LuaRuntimeOptions

These options control the underlying Lua engine behavior. They're part of `LuaBridgeOptions`.

| Option | Type | Default | Description |
|---|---|---|---|
| `openStandardLibs` | `boolean` | `true` | Open Lua standard libraries (base, table, string, math, etc.) |
| `injectObjects` | `boolean` | `true` | Inject JS objects as Lua-compatible values |
| `enableProxy` | `boolean` | `true` | Enable proxy behavior for object bridging |
| `traceAllocations` | `boolean` | `false` | Track allocation metadata for memory diagnostics |
| `functionTimeout` | `number` | `1000` | Max execution time per Lua call in milliseconds |

---

## LuaBridgeOptions

All options accepted by `createLuaBridge()` and the `LuaBridge` constructor.

| Option | Type | Default | Description |
|---|---|---|---|
| `mainLoopIntervalMs` | `number` | `16` | Default tick interval for the update loop (ms) |
| `wasmUri` | `string` | auto-detected | Custom URI for the Lua WASM binary |
| `bindings` | `LuaBindingFactory[]` | `[]` | Binding factories to install during init |
| `files` | `Record<string, string>` | `{}` | Files to pre-mount before any execution |

Plus all [LuaRuntimeOptions](#lualuaRuntimeOptions) above.

---

## RuntimeStartOptions

Passed to `bridge.start()`.

| Option | Type | Default | Description |
|---|---|---|---|
| `intervalMs` | `number` | `16` | Tick interval for the update loop (ms) |

---

## LuaBinderOptions

Passed to the `@LuaBinder` decorator.

| Option | Type | Default | Description |
|---|---|---|---|
| `namespace` | `string` | — | Lua namespace table (omit to put methods in `_G`) |
| `readonly` | `boolean` | `false` | Reject writes to the namespace table (requires `namespace`; throws if set without one) |
| `callable` | `boolean` | `false` | Make the namespace callable via `__call` |
| `hooks` | `{ before?, after? }` | — | Lifecycle hooks called before/after every binding method |

---

## LuaBindingOptions

Passed to the `@LuaBinding` decorator.

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | JS method name | Name exposed to Lua |
| `args` | `Array<{name, type}>` | — | Argument descriptors (documentation only) |
| `returnType` | `unknown` | — | Return type descriptor (documentation only) |
| `isMethod` | `boolean` | `false` | First argument is `self` (Lua `:` syntax) |
| `isAsync` | `boolean` | `false` | Binding returns a Promise |

---

## Defaults summary

Here's a bridge created with no options:

```ts
const bridge = await createLuaBridge();
// Equivalent to:
const bridge = await createLuaBridge({}, {
  openStandardLibs: true,
  injectObjects: true,
  enableProxy: true,
  traceAllocations: false,
  functionTimeout: 1000,
  mainLoopIntervalMs: 16,
  // wasmUri: auto from wasmoon
  bindings: [],
  files: {},
});
```
