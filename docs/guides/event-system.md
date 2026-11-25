---
title: Event System
description: Bidirectional JS ↔ Lua event bus with typed payloads
sidebar_position: 4
---

# Event System

Events let JavaScript and Lua talk to each other without polling or shared state. Both sides can emit events and listen for events through the same bus.

---

## JavaScript side

### on() — listen for events

```ts
const unsubscribe = bridge.on("player:joined", (playerId: string) => {
  console.log("Player joined:", playerId);
});

// Later: stop listening
unsubscribe();
```

`on()` returns an unsubscribe function — call it to remove the listener.

### off() — remove a listener

```ts
function handler(name: string) {
  console.log(name);
}

bridge.on("greet", handler);
bridge.off("greet", handler); // removed
```

### emit() — fire an event from JS

```ts
const handlerCount = bridge.emit("player:data", { name: "Ada", score: 100 });
```

Returns the number of handlers that were invoked.

---

## Lua side

Lua uses the `Events` global with PascalCase names (matching Lua's `:` method convention).

### Events:On() — listen for events

```lua
Events:On("player:data", function(payload)
  print("Received:", payload.name)
end)
```

The method returns an unsubscribe function:

```lua
local unsub = Events:On("tick", function()
  print("tick")
end)

-- Later:
unsub()
```

### Events:Off() — remove a listener

```lua
local function handler(payload)
  print(payload)
end

Events:On("msg", handler)
Events:Off("msg", handler)
```

### Events:Emit() — fire an event from Lua

```lua
Events:Emit("player:joined", "Ada", 42)
```

---

## Bidirectional example

```ts
const bridge = await createLuaBridge();

// JS listens for Lua events
bridge.on("from-lua", (msg: string) => {
  console.log("JS received:", msg);
});

// Lua listens for JS events
await bridge.execute(`
  Events:On("from-js", function(msg)
    print("[Lua] received: " .. msg)
  end)
`);

// Lua emits → JS receives
await bridge.execute('Events:Emit("from-lua", "hello from Lua")');

// JS emits → Lua receives
bridge.emit("from-js", "hello from JS");
```

Output:
```
JS received: hello from Lua
[Lua] received: hello from JS
```

---

## Typed events (TypeScript)

Define a typed event map for full IntelliSense:

```ts
type MyEvents = {
  "player:join": [playerId: string, timestamp: number];
  "data:update": [payload: Record<string, unknown>];
};

const bridge = await createLuaBridge<Record<string, unknown>, MyEvents>();

// TypeScript checks the payload types:
bridge.on("player:join", (playerId, timestamp) => {
  // playerId: string, timestamp: number
});

bridge.emit("player:join", "user-1", Date.now());
// bridge.emit("player:join", 123);       // ❌ Type error
```

---

## Built-in events

The bridge emits events for error conditions:

| Event | Payload | When |
|---|---|---|
| `mainloop:error` | `[error: unknown]` | Update loop tick throws |

```ts
bridge.on("mainloop:error", (error) => {
  console.error("Update loop error:", error);
});
```

---

## Event patterns

### One-shot listener

```ts
function once() {
  console.log("This runs once");
  bridge.off("init", once);
}
bridge.on("init", once);
```

### Namespaced events

Use a naming convention to organize events:

```ts
bridge.emit("plugin:loaded", "inventory");
bridge.emit("plugin:loaded", "quests");
bridge.emit("plugin:error", "inventory", "missing dependency");
```

Lua listeners can match on patterns:

```lua
Events:On("plugin:loaded", function(name)
  print("Plugin loaded: " .. name)
end)
```

### Scoped events

Events emitted from a scoped environment are also visible to the bridge — the event bus is shared:

```ts
const scope = await bridge.useEnvironment({ pluginId: "alpha" });

scope.execute(`
  Events:Emit("plugin:ready", pluginId)
`);

bridge.on("plugin:ready", (id: string) => {
  console.log("Plugin ready:", id); // "alpha"
});
```

---

## Related

- [Lifecycle loop](./lifecycle.md) — lifecycle events during start/shutdown
- [Scoped execution](./scoped-execution.md) — using events with isolated environments
