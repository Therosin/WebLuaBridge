# Globals

Globals are values shared between JavaScript and Lua through `_G`. WebLuaBridge provides several ways to read, write, and manage global state.

---

## Setting globals

### `setGlobal()` — set a single global

```ts
bridge.setGlobal("config", { debug: true, maxPlayers: 100 });
```

In Lua:
```lua
print(_G.config.debug)      -- true
print(_G.config.maxPlayers) -- 100
```

### `setGlobals()` — set multiple at once

```ts
bridge.setGlobals({
  appName: "MyApp",
  version: 2,
  startedAt: Date.now(),
});
```

### Constructor globals

Pass globals when creating the bridge:

```ts
const bridge = await createLuaBridge({
  theme: "dark",
  language: "en",
});
```

These are available in Lua immediately after initialization.

---

## Reading globals

### `getGlobal()` — read a single global

```ts
const config = bridge.getGlobal<{ debug: boolean }>("config");
console.log(config.debug);
```

### Deep path access: `Get()` and `Set()`

For nested globals, use dot-delimited paths:

```ts
await bridge.execute("config = { limits = { max = 100 } }");

// Read deeply nested
const max = await bridge.Get<number>("config.limits.max");
console.log(max); // 100

// With a default value for missing paths
const missing = await bridge.Get("config.foo", "fallback");
console.log(missing); // "fallback"

// Write deeply nested (auto-creates intermediate tables)
await bridge.Set("config.limits.min", 0);
await bridge.Set("config.newSection.enabled", true);
```

`Set()` creates intermediate tables automatically if they don't exist.

---

## `setField()` — set a field on a specific table

```ts
bridge.setField("config", "debug", false);
// Equivalent to Lua: _G.config.debug = false
```

Useful when you need to modify one field without replacing the whole table.

---

## Reset and re-initialize

After closing a bridge, you can reset and re-initialize it:

```ts
const bridge = await createLuaBridge({ appName: "v1" });
bridge.close();

// Reset and re-init
bridge.reset();
await bridge.init();

// Globals set before close are restored
console.log(bridge.getGlobal("appName")); // "v1"
```

`reset()` returns `true` if the bridge was in a closed state. Globals cached via `setGlobal()` are re-injected during `init()`.

---

## LuaClass globals

LuaClass instances can be passed directly to `setGlobal()`:

```ts
const cls = new LuaClass({ name: "MyLib" })
  .method("greet", (name: string) => `Hello ${name}!`);

bridge.setGlobal("MyLib", cls);

-- Lua: MyLib:greet("World") → "Hello World!"
```

See [Bindings](./bindings.md) for the full LuaClass API.

---

## Type safety

Use TypeScript generics for typed globals:

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

// TypeScript knows the types:
bridge.setGlobal("version", 2);            // OK
bridge.setGlobal("version", "two");        // Type error!
const v = bridge.getGlobal("version");     // v: number
```

---

## Next

- [Environments](./environments.md) — scoped execution
- [Bindings](./bindings.md) — exposing JS APIs to Lua
