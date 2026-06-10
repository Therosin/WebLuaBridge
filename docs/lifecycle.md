# Lifecycle

WebLuaBridge supports a managed lifecycle with init, update, and shutdown hooks — useful for game loops, long-running services, or any scenario where Lua needs to run continuously.

---

## Overview

Lifecycle mode provides three hooks in Lua:

| Hook | Called when |
|---|---|
| `OnInit()` | `start()` is called |
| `Update(dt)` | Every tick of the main loop |
| `OnShutdown()` | `shutdown()` is called |

---

## Basic lifecycle

```ts
const bridge = await createLuaBridge();
try {
  await bridge.mountFile("init.lua", `
    local ticks = 0

    function OnInit()
      print("Booted!")
    end

    function Update(dt)
      ticks = ticks + 1
      print("Tick " .. ticks .. " (dt=" .. dt .. ")")
    end

    function OnShutdown()
      print("Shutting down after " .. ticks .. " ticks")
    end
  `);

  await bridge.start({ intervalMs: 50 });  // tick every 50ms
  await new Promise(r => setTimeout(r, 200)); // run for 200ms
  await bridge.shutdown();
} finally {
  bridge.close();
}
```

Output:
```
Booted!
Tick 1 (dt=0.05)
Tick 2 (dt=0.05)
Tick 3 (dt=0.05)
Shutting down after 3 ticks
```

---

## How it works

When you call `start()`:

1. The runtime is initialized (if not already)
2. If `init.lua` is mounted, it's executed
3. `OnInit()` is called (if defined)
4. The update loop begins, calling `Update(dt)` at the configured interval
5. `dt` is the time in seconds since the last tick

When you call `shutdown()`:

1. The update loop stops
2. `OnShutdown()` is called (if defined)
3. The runtime is closed

---

## `start()` options

```ts
await bridge.start({
  intervalMs: 100, // tick every 100ms (default: 16ms ≈ 60fps)
});
```

---

## `init.lua`

If you mount a file named `init.lua`, it's executed automatically during `start()`. This is where you typically define your `OnInit`, `Update`, and `OnShutdown` functions.

```ts
await bridge.mountFile("init.lua", `
  function OnInit()
    -- setup code
  end
  function Update(dt)
    -- per-frame logic
  end
  function OnShutdown()
    -- cleanup
  end
`);
```

All three hooks are optional — only define the ones you need.

---

## Checking lifecycle state

```ts
bridge.isStarted();        // true after start(), false after shutdown()
bridge.isMainLoopActive(); // true while the update loop is running
```

---

## Manual loop control

You can start and stop the main loop independently of `start()`/`shutdown()`:

```ts
bridge.startMainLoop(50);   // start ticking at 50ms
bridge.stopMainLoop();       // stop ticking
```

This is useful when you want the loop but don't need `OnInit`/`OnShutdown` hooks.

---

## Error handling

If `Update(dt)` throws, the error is emitted as a `mainloop:error` event and the loop continues:

```ts
bridge.on("mainloop:error", (error) => {
  console.error("Update error:", error);
});
```

---

## Lifecycle with globals

Pass globals that `OnInit`/`Update` can access:

```ts
const bridge = await createLuaBridge({ hostName: "MyApp" });

await bridge.mountFile("init.lua", `
  function OnInit()
    print("Started by " .. hostName)
  end
`);

await bridge.start();
```

---

## Next

- [Events](./events.md) — JS↔Lua event bus
- [Execution](./execution.md) — running Lua code
