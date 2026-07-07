---
title: Sharing Data
description: Set and read Lua globals, traverse nested tables, and use TypeScript for type safety
sidebar_position: 2
---

# Sharing Data

Globals are the shared bridge between JavaScript and Lua. Set them from JS, read them in Lua, and vice versa.

---

## Setting globals

### Set — single value or dotted path

```ts
await bridge.Set("config", { debug: true, maxPlayers: 100 });
await bridge.Set("config.maxPlayers", 200); // dotted path
```

In Lua:
```lua
print(config.debug)      -- true
print(config.maxPlayers) -- 200
```

LuaClass instances are automatically installed with proper metatable behavior:

```ts
import { LuaClass } from "./mod.ts";

const cls = new LuaClass({ name: "MyLib" })
  .method("greet", (name: string) => `Hello ${name}!`);

await bridge.Set("MyLib", cls);
```

### Constructor globals

Pass globals when creating the bridge — they're available in Lua immediately after initialization:

```ts
const bridge = await createLuaBridge({
  theme: "dark",
  language: "en",
  limits: { maxScore: 9999 },
});
```

---

## Reading globals

### Get — single value or dotted path

```ts
const config = await bridge.Get<{ debug: boolean }>("config");
console.log(config.debug);

// Nested with fallback default
const max = await bridge.Get<number>("config.limits.max");
const missing = await bridge.Get("config.foo", "fallback"); // "fallback"
```

`Get` auto-detects flat vs dotted paths. Returns `undefined` for missing keys with no default.

---

## Function handles

### GetFunction — call a Lua function from JS

```ts
await bridge.execute("function add(a, b) return a + b end");
const add = bridge.GetFunction<(a: number, b: number) => number>("add");
const sum = await add(40, 2); // 42
```

### GetMethod — call a Lua method with `self` binding

```lua
-- Lua
game = { name = "Test" }
function game:getInfo(id)
    return self.name .. ":" .. id
end
```

```ts
const getInfo = bridge.GetMethod<(id: number) => string>("game.getInfo");
const result = await getInfo(42); // "Test:42"
```

The parent table (`_G.game`) is resolved fresh each call and passed as `self`.

### SetFunction / SetMethod — expose JS functions to Lua

```ts
bridge.SetFunction("jsFunc", (a: number, b: number) => a + b);
const result = await bridge.execute("return jsFunc(40, 2)"); // 42

bridge.SetMethod("math.add", (a: number, b: number) => a + b);
await bridge.execute("return math.add(40, 2)"); // 42
```

---

## Deprecated methods

The following methods are deprecated and will be removed in a future version:

| Method | Replacement |
|---|---|
| `setGlobal()` | `Set()` |
| `setGlobals()` | `Set()` (individual calls) |
| `getGlobal()` | `Get()` |
| `getDeep()` | `Get()` |
| `setDeep()` | `Set()` |
| `setField()` | `Set("table.field", value)` |

---

## Type safety with TypeScript

Define the shape of your globals for full IntelliSense:

```ts
interface AppGlobals {
  appName: string;
  version: number;
  config: { debug: boolean };
}

const bridge = await createLuaBridge<AppGlobals>({
  appName: "MyApp",
  version: 1,
  config: { debug: true },
});

await bridge.Set("version", 2);     // OK — number
await bridge.Set("version", "two"); // ❌ Type error!
const v = await bridge.Get("version"); // v: number
```

---

## Typed events

You can also type the event system:

```ts
type MyEvents = {
  "player:join": [playerId: string, timestamp: number];
  "game:over": [score: number];
};

const bridge = await createLuaBridge<AppGlobals, MyEvents>();

bridge.on("player:join", (playerId, timestamp) => {
  // playerId: string, timestamp: number
});
```

---

## Reopen and re-initialize

After closing a bridge, you can reopen it and re-initialize:

```ts
const bridge = await createLuaBridge({ appName: "v1" });
bridge.close();

bridge.reopen();    // clear closed state
await bridge.init(); // re-initialize

console.log(await bridge.Get("appName")); // "v1"
```

`reopen()` returns `true` if the bridge was closed. Globals set via `Set()` (including dotted paths) are re-injected during `init()`.

---

## Related

- [Running Lua code](./running-lua.md) — execute and call Lua
- [Scoped execution](./scoped-execution.md) — isolated environments for plugins
