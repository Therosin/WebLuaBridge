# Events

WebLuaBridge has a bidirectional event bus. JavaScript can listen to and emit events; Lua can do the same through the `Events` global.

---

## JavaScript side

### `bridge.on()` — listen for events

```ts
const bridge = await createLuaBridge();
try {
  const unsubscribe = bridge.on("plugin:ready", (id: string) => {
    console.log("Plugin ready:", id);
  });

  // Later: stop listening
  unsubscribe();
} finally {
  bridge.close();
}
```

`on()` returns an unsubscribe function. Call it to remove the listener.

### `bridge.off()` — remove a listener

```ts
function handler(name: string) {
  console.log(name);
}

bridge.on("greet", handler);
bridge.off("greet", handler); // removed
```

### `bridge.emit()` — emit an event from JS

```ts
bridge.emit("plugin:data", { key: "value" });
```

Returns the number of handlers that were invoked.

---

## Lua side

From Lua, the `Events` global provides the same API with PascalCase method names (Lua convention for `:` method calls):

### `Events:On()` — listen for events

```lua
Events:On("plugin:data", function(payload)
  print("Received:", payload.key)
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

### `Events:Off()` — remove a listener

```lua
local function handler(payload)
  print(payload)
end

Events:On("msg", handler)
Events:Off("msg", handler)
```

### `Events:Emit()` — emit an event from Lua

```lua
Events:Emit("plugin:ready", "alpha", 42)
```

---

## Bidirectional example

```ts
const bridge = await createLuaBridge();
try {
  // JS listens
  bridge.on("from-lua", (msg: string) => {
    console.log("JS received:", msg);
  });

  // Lua listens
  await bridge.execute(`
    Events:On("from-js", function(msg)
      print("[Lua] received: " .. msg)
    end)
  `);

  // Lua emits → JS receives
  await bridge.execute(`Events:Emit("from-lua", "hello from Lua")`);

  // JS emits → Lua receives
  bridge.emit("from-js", "hello from JS");
} finally {
  bridge.close();
}
```

---

## Typed events (TypeScript)

You can define a typed event map for stronger IntelliSense:

```ts
type MyEvents = {
  "user:login": [userId: string, timestamp: number];
  "data:update": [payload: Record<string, unknown>];
};

const bridge = await createLuaBridge<Record<string, unknown>, MyEvents>();

// TypeScript now checks:
bridge.on("user:login", (userId, timestamp) => {
  // userId: string, timestamp: number
});

bridge.emit("user:login", "user-1", Date.now());
```

---

## Lifecycle events

The bridge emits built-in events you can listen to:

| Event | Payload | When |
|---|---|---|
| `mainloop:error` | `[error: unknown]` | An error occurs during the update loop tick |

```ts
bridge.on("mainloop:error", (error) => {
  console.error("Update loop error:", error);
});
```

---

## Next

- [Lifecycle](./lifecycle.md) — `start()`/`shutdown()` with init/update hooks
- [Environments](./environments.md) — scoped execution
