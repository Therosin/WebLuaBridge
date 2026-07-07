---
title: Troubleshooting
description: Common issues and their solutions
sidebar_position: 5
---

# Troubleshooting

## Bridge operations throw "Bridge is not initialized"

Call `init()` or use `createLuaBridge()` (which calls `init()` for you):

```ts
const bridge = await createLuaBridge(); // ✅ calls init() internally
```

If using the constructor directly, you must call `init()` before any operations:

```ts
const bridge = new LuaBridge();
await bridge.init(); // ✅ required before execute(), call(), etc.
```

## Lua errors corrupt the bridge

They don't — the bridge survives Lua errors:

```ts
try {
  await bridge.execute("error('oops')");
} catch {
  // Bridge is still usable
}
const result = await bridge.execute("return 42"); // works fine
```

If the bridge seems stuck, check for an active `start()` loop or a `functionTimeout` that's too short.

## Execution hangs or times out

1. **Check `functionTimeout`** — default is 1000ms. Increase it for long-running Lua:

```ts
const bridge = await createLuaBridge({}, { functionTimeout: 5000 });
```

2. **Check for infinite loops in Lua** — Lua code that loops forever will hit the timeout.

3. **Check `withExecutionLock` signal** — if you passed an already-aborted signal to `withExecutionLock()`, operations will throw `OPERATION_CANCELLED`.

## `executeRaw()` causes race conditions

`executeRaw()` bypasses the execution lock. If you're calling it while async operations are in flight, results are unpredictable.

```ts
// Avoid:
bridge.executeRaw("x = 1");
await bridge.execute("y = 2"); // may race with sync call
```

Use `execute()` (async with lock) in concurrent contexts.

## Events not reaching Lua

Make sure you're using the `Events` global with PascalCase:

```lua
-- ✅ Correct
Events:On("my-event", handler)

-- ❌ Wrong — Events.On is a field, not a function
Events.On("my-event", handler)
```

Also verify that the event was emitted after the `Events:On()` call was executed:

```ts
// ❌ Won't work — listener registered after emit
bridge.emit("test");
await bridge.execute('Events:On("test", handler)');

// ✅ Correct
await bridge.execute('Events:On("test", handler)');
bridge.emit("test");
```

## Lifecycle hooks not firing

1. **Mount `init.lua`** — lifecycle hooks (`OnInit`, `Update`, `OnShutdown`) must be defined in a mounted file or existing globals:

```ts
await bridge.mountFile("init.lua", `
  function OnInit() print("ready") end
  function Update(dt) end
  function OnShutdown() end
`);
```

2. **Call `start()` not `init()`** — `init()` only initializes the runtime. Call `start()` to begin the lifecycle loop.

## Memory grows too large

Set a memory cap:

```ts
bridge.setMemoryMax(10 * 1024 * 1024); // 10 MB
```

When the limit is exceeded, Lua allocations fail with an out-of-memory error.

## WASM binary fails to load

If you see WASM loading errors:

1. Check the `wasmUri` option — ensure it points to a valid WASM binary
2. For self-contained browser bundles, make sure the build script ran correctly
3. In Deno, the factory auto-discovers the WASM path — no configuration needed

## Browser bundle is too large

The embedded WASM binary is ~300KB (gzipped). To reduce size:

- Use the minified bundle (`webluabridge.bundle.min.js`)
- Serve the WASM binary separately instead of inlining it
- Configure your bundler to handle WASM separately

## Print capture not working

Make sure to call `onPrint()` before the Lua code runs:

```ts
const logs: string[] = [];
bridge.onPrint((msg) => logs.push(msg));

await bridge.execute('print("hello")'); // ✅ captured
```

Pass `null` to restore the original print:

```ts
bridge.onPrint(null);
```
