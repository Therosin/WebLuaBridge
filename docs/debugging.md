# Debugging

WebLuaBridge provides tools for capturing Lua output, inspecting memory, and dumping the Lua stack.

---

## Capturing `print()` output

Redirect Lua's `print()` to a JavaScript callback:

```ts
const bridge = await createLuaBridge();
try {
  const logs: string[] = [];

  bridge.onPrint((message: string) => {
    logs.push(message);
  });

  await bridge.execute('print("hello", "world")');
  console.log(logs); // ["hello\tworld"]
} finally {
  bridge.close();
}
```

The callback receives a single string — all arguments joined with a tab (matching Lua's default `print` behavior).

### Restoring original `print()`

Pass `null` to restore the original:

```ts
bridge.onPrint(null);
```

### Checking if capture is active

The bridge internally tracks whether `print` is being captured. Calling `onPrint()` multiple times with different callbacks works correctly — the most recent callback replaces the previous one.

---

## Memory management

### Get memory usage

```ts
const used = bridge.getMemoryUsed();
console.log(`Lua using ${used} bytes`);
```

Requires `traceAllocations: true` in runtime options for accurate tracking:

```ts
const bridge = await createLuaBridge({}, {
  traceAllocations: true,
});
```

### Set a memory cap

Limit how much memory Lua can allocate:

```ts
bridge.setMemoryMax(10 * 1024 * 1024); // 10 MB
```

When the limit is exceeded, Lua allocations fail with an out-of-memory error.

### Get the current cap

```ts
const max = bridge.getMemoryMax();
console.log(max === undefined ? "No limit" : `${max} bytes`);
```

### Remove the cap

```ts
bridge.setMemoryMax(undefined);
```

---

## Dumping the Lua stack

Inspect the current Lua call stack for debugging:

```ts
bridge.dumpStack();
```

Output is printed to `console.log` by default. Pass a custom logger:

```ts
bridge.dumpStack((...args) => {
  fs.appendFileSync("debug.log", args.join(" ") + "\n");
});
```

---

## Error handling patterns

### Try/catch around execution

All execution methods throw on Lua errors with a descriptive message:

```ts
try {
  await bridge.execute("error('something went wrong')");
} catch (err) {
  console.error(err.message);
  // "Failed to execute code: something went wrong"
}
```

### The bridge survives errors

After a Lua error, the bridge remains in a usable state. You don't need to recreate it:

```ts
try {
  await bridge.execute("error('oops')");
} catch {
  // ignore
}
// Bridge still works
const result = await bridge.execute("return 42");
console.log(result); // 42
```

### Main loop errors

Errors during the `Update(dt)` lifecycle hook are emitted as events rather than crashing:

```ts
bridge.on("mainloop:error", (error) => {
  console.error("Update error:", error);
});
```

---

## Checking engine state

```ts
bridge.isStarted();          // true if lifecycle mode is active
bridge.isMainLoopActive();   // true if the update loop is running
```

---

## Next

- [Execution](./execution.md) — all the ways to run Lua code
- [Lifecycle](./lifecycle.md) — managed init/update/shutdown flow
