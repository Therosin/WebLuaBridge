---
title: Getting Started
description: Install, create your first bridge, and run Lua code from TypeScript
sidebar_position: 1
---

# Getting Started

## Installation

### Deno

Import directly — no install step needed:

```ts
import { createLuaBridge, runLuaCode } from "./mod.ts";
```

For published projects, pin a version:

```ts
import { createLuaBridge } from "https://raw.githubusercontent.com/Therosin/WebLuaBridge/v0.1.0/mod.ts";
```

### Browser

Use the pre-built ESM bundle:

```html
<script type="module">
  import { createLuaBridge } from "./dist/webluabridge.bundle.min.js";
  // ...
</script>
```

See the [browser guide](./guides/browser.md) for full details.

---

## Your first bridge

Create a bridge, run Lua, and clean up:

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

`createLuaBridge()` initializes the Lua runtime and returns a bridge instance. Always call `bridge.close()` when you're done.

---

## Passing data to Lua

Inject globals when creating the bridge:

```ts
const bridge = await createLuaBridge({
  playerName: "Ada",
  score: 100,
  config: { theme: "dark" },
});

const result = await bridge.execute(`
  return "Player: " .. playerName .. ", score: " .. score
`);
console.log(result); // "Player: Ada, score: 100"
```

These values are available in Lua's global `_G` table.

---

## Calling Lua functions from JS

Define a function in Lua, then call it from TypeScript:

```ts
await bridge.execute(`
  function greet(name)
    return "Hello, " .. name .. "!"
  end
`);

const message = await bridge.call<string>("greet", "World");
console.log(message); // "Hello, World!"
```

`call()` is more efficient than string-wrapping — it invokes the Lua function directly.

---

## One-shot execution

When you only need to run Lua once and don't need the bridge afterwards:

```ts
const result = await runLuaCode("return 1 + 2 + 3");
console.log(result); // 6
```

`runLuaCode()` creates a temporary bridge, runs your code, and closes the runtime automatically.

You can also pass arguments:

```ts
const result = await runLuaCode("return ... + 10", 32);
console.log(result); // 42
```

---

## Multi-return values

When Lua returns multiple values, they come back as an array:

```ts
const result = await bridge.execute("return 1, 2, 3");
console.log(result); // [1, 2, 3]
```

A single return value comes back directly (not wrapped). No return gives `undefined`.

---

## Error handling

Wrap execution in try/catch:

```ts
try {
  await bridge.execute("error('something went wrong')");
} catch (err) {
  console.error(err.message);
  // "Failed to execute code: something went wrong"
}
```

The bridge survives errors — you can keep using it after a failed call.

---

## What's next

- [Running Lua code](./guides/running-lua.md) — execute, call, files, modules, sync
- [Sharing data](./guides/sharing-data.md) — globals, deep paths, type safety
- [Event system](./guides/event-system.md) — JS ↔ Lua communication
