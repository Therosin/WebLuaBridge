---
title: Scoped Execution
description: Create isolated Lua environments for plugins, mods, and sandboxed scripts
sidebar_position: 3
---

# Scoped Execution

`useEnvironment()` creates an isolated execution scope backed by a JavaScript object. Lua code reads from the object first, then falls back to `_G`. Writes always go to the object.

This is ideal for **plugin systems**, **modding APIs**, **multi-tenant scripts**, or any situation where you need to control what Lua code can access.

---

## Basic usage

```ts
const bridge = await createLuaBridge();
const scope = await bridge.useEnvironment({
  userName: "Ada",
  score: 10,
});

await scope.execute(`
  score = score + 5
  greeting = "Hi, " .. userName
`);

console.log(scope.environment.score);    // 15
console.log(scope.environment.greeting); // "Hi, Ada"
```

The scope object (`scope.environment`) is the same JavaScript object you passed in — Lua reads and writes modify it directly.

---

## How scope resolution works

Reads: **env → `_G`** — environment first, then fall back to global scope

```ts
// Define a function in global scope
await bridge.execute("function double(x) return x * 2 end");

// Create an environment without 'double'
const scope = await bridge.useEnvironment({ value: 21 });

// Lua can still call _G.double()
const result = await scope.execute("return double(value)");
console.log(result); // 42
```

Writes: **always env** — never touch `_G`

```ts
const scope = await bridge.useEnvironment({ x: 1 });
await scope.execute("x = 10");
// _G.x is unchanged
```

---

## Scope methods

Every scope has convenience methods for managing environment data:

### Get / Set

```ts
scope.Set("newKey", 42);
const val = scope.Get<number>("newKey");
```

> **Note:** Scope `Get`/`Set` operate on **flat keys** of the environment object. A key like `"a.b"` is treated as a literal key name, not a dotted path. This differs from `bridge.Get()`/`bridge.Set()`, which traverse table paths on dots.

### has / delete

```ts
if (scope.has("userName")) {
  scope.delete("userName");
}
```

### keys / clear

```ts
console.log(scope.keys()); // ["score", "greeting"]
scope.clear();
```

### assign — batch updates

```ts
scope.assign({ level: 5, active: true });
```

---

## eval — evaluate expressions

Shorthand for `execute("return <expression>")`:

```ts
const greeting = await scope.eval<string>('"Hello, " .. userName');
// "Hello, Ada"
```

---

## call — call scoped functions

```ts
await scope.execute(`
  function greet(name)
    return "Hello, " .. name
  end
`);

const msg = await scope.call<string>("greet", "World");
// "Hello, World"
```

---

## Mount files in scopes

Files mounted in a scope are only available within that scope:

```ts
const scope = await bridge.useEnvironment({}, {
  files: {
    "plugin/helpers.lua": "function normalize(s) return s:lower() end",
  },
});

await scope.execute('return require("plugin/helpers").normalize("HELLO")');
// "hello"
```

---

## Real-world example: plugin system

Here's a minimal plugin host that loads and runs isolated Lua plugins:

```ts
interface PluginEnv {
  name: string;
  api: { log: (msg: string) => void };
  state: Record<string, unknown>;
}

const bridge = await createLuaBridge();

async function runPlugin(name: string, code: string) {
  const env: PluginEnv = {
    name,
    api: {
      log: (msg) => console.log(`[${name}] ${msg}`),
    },
    state: {},
  };

  const scope = await bridge.useEnvironment(env);
  await scope.execute(code);

  const result = await scope.call<boolean>("init");
  return { env: scope.environment, result };
}

// Plugin A — no access to Plugin B's data
const pluginA = await runPlugin("logger", `
  function init()
    api.log("starting up")
    state.counter = 0
    return true
  end
`);

const pluginB = await runPlugin("scorekeeper", `
  function init()
    state.scores = { player1 = 100 }
    -- has no access to pluginA's state or functions
    return true
  end
`);
```

Each plugin gets its own environment. They share the global `_G` for built-in functions but can't touch each other's state.

---

## Related

- [Sharing data](./sharing-data.md) — managing global state
- [Event system](./event-system.md) — communication between scopes
- [Exposing JS APIs](./exposing-js-apis.md) — providing APIs to plugin code
