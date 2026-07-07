---
title: Running Lua Code
description: Execute Lua strings, call functions, mount files, and load modules
sidebar_position: 1
---

# Running Lua Code

WebLuaBridge gives you several ways to run Lua code. The right choice depends on what you're doing:

| Method | When to use |
|---|---|
| `execute()` | Run a Lua string (async) |
| `call()` | Call a named Lua function directly |
| `executeRaw()` | Run sync (bypasses lock) when async is not possible |
| `runLuaCode()` | One-shot: create, run, cleanup |
| `executeFile()` | Run a mounted `.lua` file |
| `loadModule()` | Pre-register a module for `require()` |

---

## Execute a string

The most common way to run Lua:

```ts
const result = await bridge.execute("return 40 + 2");
console.log(result); // 42
```

### Pass arguments

Arguments after the code string become Lua varargs (`...`):

```ts
const result = await bridge.execute("return ...", "hello");
console.log(result); // "hello"
```

Multiple arguments:

```ts
const [a, b, c] = await bridge.execute("return ...", 10, 20, 30);
```

### Multi-return

When Lua returns multiple values, they arrive as an array:

```ts
const result = await bridge.execute("return 1, 2, 3");
// [1, 2, 3]
```

A single return comes back directly. No return gives `undefined`.

---

## Call a Lua function

More efficient than string-wrapping for function calls:

```ts
await bridge.execute(`
  function add(a, b)
    return a + b
  end
  function stats()
    return 1, 2, 3
  end
`);

const sum = await bridge.call<number>("add", 20, 22); // 42
const [a, b, c] = await bridge.call("stats"); // [1, 2, 3]
```

### With AbortSignal

Cancel a queued call before it starts executing:

```ts
const controller = new AbortController();

// Cancel before the call runs
controller.abort();

const result = await bridge.withExecutionLock(
    () => bridge.call("add", 20, 22),
    controller.signal,
);
// throws BridgeError with code OPERATION_CANCELLED
```

The `signal` parameter works with `withExecutionLock()` for all execution methods.

---

## Raw execution (bypasses lock)

When async isn't practical:

```ts
const result = bridge.executeRaw<number>("return 40 + 2");
console.log(result); // 42
```

There's also `executeFileRaw()` for files.

> ⚠️ Raw methods bypass the execution lock. Only use them in single-threaded contexts where you control access to the bridge.

---

## One-shot execution

For throwaway execution — no bridge management needed:

```ts
import { runLuaCode } from "./mod.ts";

const result = await runLuaCode("return 1 + 2 + 3"); // 6
const withArgs = await runLuaCode("return ... + 10", 32); // 42
```

`runLuaCode()` creates a bridge, runs the code, and closes the runtime.

---

## Mount and run files

### Mount a file

Load Lua source into the virtual filesystem:

```ts
await bridge.mountFile("greet.lua", `
  return "Hello from a file"
`);
```

### Execute the file

```ts
const message = await bridge.executeFile<string>("greet.lua");
// "Hello from a file"
```

Pass arguments via the `args` global:

```ts
await bridge.mountFile("echo.lua", `
  return "You said: " .. args[1]
`);
const result = await bridge.executeFile("echo.lua", "hello");
// "You said: hello"
```

### Pre-mount files at creation

Mount files before any code runs by passing them in options:

```ts
const bridge = await createLuaBridge({}, {
  files: {
    "lib/utils.lua": "function add(a,b) return a+b end",
    "config.lua": "return { debug = true }",
  },
});
```

These are available immediately after `createLuaBridge()` resolves.

---

## Load a module

Register code as a Lua module that can be `require()`'d:

```ts
await bridge.loadModule("mymod", `
  local M = {}
  function M.hello()
    return "hi"
  end
  return M
`);

const result = await bridge.execute("return require('mymod').hello()");
// "hi"
```

---

## Error handling

Wrap execution calls in try/catch:

```ts
try {
  await bridge.execute("error('oops')");
} catch (err) {
  console.error(err.message);
  // "Failed to execute code: oops"
}
```

The bridge remains usable after a Lua error — the runtime is not corrupted.

For structured error handling, check `err.code` against `ErrorCodes`:

```ts
import { BridgeError, ErrorCodes } from "./mod.ts";

try {
  await bridge.execute(badCode);
} catch (err) {
  if (err instanceof BridgeError) {
    switch (err.code) {
      case ErrorCodes.SYNTAX:
        // Show syntax help
        break;
      case ErrorCodes.EXECUTION:
        // Runtime error — show Lua traceback
        break;
    }
  }
}
```

See [error codes](../reference/error-codes.md) for all available codes.

---

## Related

- [Sharing data](./sharing-data.md) — set and read globals
- [Scoped execution](./scoped-execution.md) — isolated execution environments
