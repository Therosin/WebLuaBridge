# Execution

WebLuaBridge provides several ways to run Lua code. This guide covers all of them.

---

## `execute()` — run a string of Lua code

```ts
const bridge = await createLuaBridge();
try {
  const result = await bridge.execute("return 40 + 2");
  console.log(result); // 42
} finally {
  bridge.close();
}
```

Pass arguments to your Lua code:

```ts
const result = await bridge.execute("return ...", "hello");
console.log(result); // "hello"
```

Lua receives these as varargs (`...`). You can also pass multiple arguments:

```ts
const result = await bridge.execute("return ...", 10, 20, 30);
console.log(result); // 10  (first arg only)
```

### Multi-return values

When Lua returns multiple values, they come back as an array:

```ts
const result = await bridge.execute("return 1, 2, 3");
console.log(result); // [1, 2, 3]
```

A single return value is returned directly (not wrapped in an array). No return values yield `undefined`.

---

## `call()` — invoke a named Lua function

```ts
await bridge.execute(`
  function add(a, b)
    return a + b
  end
  function stats()
    return 1, 2, 3
  end
`);

const sum = await bridge.call<number>("add", 20, 22);
console.log(sum); // 42

const [a, b, c] = await bridge.call("stats");
console.log(a, b, c); // 1, 2, 3
```

`call()` is more efficient than `execute("return fn(...)")` — it invokes the function directly without string-wrapping.

---

## `executeSync()` — synchronous execution

When async/await is inconvenient, use the synchronous variant:

```ts
const result = bridge.executeSync<number>("return 40 + 2");
console.log(result); // 42
```

**Note:** `executeSync()` bypasses the execution lock. Use it only in single-threaded contexts where you control access to the bridge.

---

## `runLuaCode()` — one-shot execution

```ts
import { runLuaCode } from "./mod.ts";

const result = await runLuaCode("return 1 + 2 + 3");
console.log(result); // 6
```

Creates a temporary bridge, executes the code, and closes the runtime. Ideal for single-use evaluation.

You can pass arguments too:

```ts
const result = await runLuaCode("return ... + 10", 32);
console.log(result); // 42
```

---

## Mounting and running files

### `mountFile()` — load a Lua file into memory

```ts
await bridge.mountFile("greet.lua", `
  return "Hello from a file"
`);
```

Mounted files live in Wasmoon's virtual filesystem. They're available immediately.

### `executeFile()` — run a mounted file

```ts
const message = await bridge.executeFile<string>("greet.lua");
console.log(message); // "Hello from a file"
```

Pass arguments via the `args` global:

```ts
await bridge.mountFile("echo.lua", `
  return "You said: " .. args[1]
`);
const result = await bridge.executeFile("echo.lua", "hello");
console.log(result); // "You said: hello"
```

### `executeFileSync()` — synchronous file execution

```ts
const result = bridge.executeFileSync<string>("greet.lua");
```

---

## `loadModule()` — register a Lua module

Pre-load a module so Lua can `require()` it:

```ts
await bridge.loadModule("mymod", `
  local M = {}
  function M.hello()
    return "hi"
  end
  return M
`);

const result = await bridge.execute("return require('mymod').hello()");
console.log(result); // "hi"
```

---

## Error handling

All execution methods throw on Lua errors. Wrap calls in try/catch:

```ts
try {
  await bridge.execute("error('oops')");
} catch (err) {
  console.error(err.message); // "Failed to execute code: oops"
}
```

The bridge remains usable after a Lua error — the runtime is not corrupted.

---

## Pre-mounting files

You can mount files at bridge creation time:

```ts
const bridge = await createLuaBridge({}, {
  files: {
    "lib/utils.lua": "function add(a,b) return a+b end",
    "config.lua": "return { debug = true }",
  },
});
```

These files are available immediately after `createLuaBridge()` resolves.

---

## Next

- [Globals](./globals.md) — sharing state between JS and Lua
- [Events](./events.md) — communication between JS and Lua
