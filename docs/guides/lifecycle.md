---
title: Lifecycle Loop
description: Managed start/shutdown cycle with OnInit, Update, and OnShutdown hooks for game loops and long-running services
sidebar_position: 5
---

# Lifecycle Loop

The lifecycle system provides a managed runtime loop — useful for game scripting, simulation ticks, or any scenario where Lua needs to run continuously.

---

## Overview

The lifecycle gives you three Lua hooks:

| Hook | Called when | Purpose |
|---|---|---|
| `OnInit()` | `start()` is called | One-time setup |
| `Update(dt)` | Every loop tick | Per-frame logic (dt = seconds since last tick) |
| `OnShutdown()` | `shutdown()` is called | Cleanup |

---

## Basic example

```ts
const bridge = await createLuaBridge();

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

await bridge.start({ intervalMs: 50 });
await new Promise(r => setTimeout(r, 200)); // let it run
await bridge.shutdown();
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

1. Runtime is initialized (if not already)
2. `init.lua` is executed (if mounted)
3. `OnInit()` is called (if defined)
4. The update loop begins, calling `Update(dt)` at the configured interval

When you call `shutdown()`:

1. The update loop stops
2. `OnShutdown()` is called (if defined)
3. The runtime is closed

---

## init.lua

Mount a file named `init.lua` to auto-execute during `start()`. This is where you define your lifecycle functions:

```ts
await bridge.mountFile("init.lua", `
  function OnInit()
    -- setup: allocate state, connect services
  end

  function Update(dt)
    -- per-frame: update entities, process input
  end

  function OnShutdown()
    -- cleanup: save state, release resources
  end
`);
```

All three hooks are optional — define only the ones you need.

---

## Configuration

```ts
await bridge.start({
  intervalMs: 100, // tick every 100ms (default: 16ms ≈ 60fps)
});
```

---

## Checking state

```ts
bridge.isStarted();        // true after start(), false after shutdown()
bridge.isMainLoopActive(); // true while the update loop is running
```

---

## Manual loop control

Start and stop the loop independently of `start()`/`shutdown()`:

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

## Working with globals

Pass globals that lifecycle hooks can access:

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

## Full game scripting example

```ts
const bridge = await createLuaBridge({
  world: { time: 0, entities: [] },
});

await bridge.mountFile("init.lua", `
  function OnInit()
    world.entities = {
      { name = "Player", hp = 100 },
      { name = "Goblin", hp = 30 },
    }
    print("World initialized with " .. #world.entities .. " entities")
  end

  function Update(dt)
    world.time = world.time + dt
    -- Entities regenerate health over time
    for _, e in ipairs(world.entities) do
      if e.hp < 100 then
        e.hp = math.min(100, e.hp + dt * 5)
      end
    end
  end

  function OnShutdown()
    print("Simulated for " .. math.floor(world.time) .. " seconds")
  end
`);

await bridge.start({ intervalMs: 100 });
await new Promise(r => setTimeout(r, 500));
await bridge.shutdown();
```

---

## Related

- [Event system](./event-system.md) — reacting to lifecycle errors
- [Exposing JS APIs](./exposing-js-apis.md) — binding JS modules for Lua access
