# Scoped Environments

`useEnvironment()` creates an isolated execution scope backed by a JavaScript object. Lua code running in the scope reads from the object first, then falls back to `_G`. Writes always go to the object.

This is ideal for plugins, sandboxes, or any situation where you want Lua code to work with a controlled set of variables.

---

## Basic usage

```ts
const bridge = await createLuaBridge();
try {
  const scope = await bridge.useEnvironment({ userName: "Ada", score: 10 });

  await scope.execute(`
    score = score + 5
    greeting = "Hi, " .. userName
  `);

  console.log(scope.environment.score);    // 15
  console.log(scope.environment.greeting); // "Hi, Ada"
} finally {
  bridge.close();
}
```

The scope object (`scope.environment`) holds all the state. Lua reads/writes directly modify it.

---

## Fallback to `_G`

If a variable doesn't exist in the environment, Lua falls back to the global scope:

```ts
const bridge = await createLuaBridge();
try {
  // Define a function in global scope
  await bridge.execute("function double(x) return x * 2 end");

  // Create an environment without 'double'
  const scope = await bridge.useEnvironment({ value: 21 });

  // Lua can still call _G.double()
  const result = await scope.execute("return double(value)");
  console.log(result); // 42
} finally {
  bridge.close();
}
```

Writes never fall back — `score = 10` in the scope always writes to the environment object, never to `_G`.

---

## Environment methods

The scope object provides several convenience methods:

### `scope.get()` / `scope.set()` — direct JS access

```ts
scope.set("newKey", 42);
const val = scope.get<number>("newKey");
```

### `scope.has()` / `scope.delete()` — key management

```ts
if (scope.has("userName")) {
  scope.delete("userName");
}
```

### `scope.keys()` / `scope.clear()` — enumeration

```ts
console.log(scope.keys()); // ["score", "greeting"]
scope.clear();
console.log(scope.keys()); // []
```

### `scope.assign()` — batch updates

```ts
scope.assign({ level: 5, active: true });
```

---

## `scope.eval()` — evaluate expressions

```ts
const greeting = await scope.eval<string>('"Hello, " .. userName');
console.log(greeting); // "Hello, Ada"
```

`eval()` is shorthand for `execute("return <expression>")` — it automatically wraps your expression in a `return` statement.

---

## `scope.call()` — call scoped functions

```ts
await scope.execute(`
  function greet(name)
    return "Hello, " .. name
  end
`);

const msg = await scope.call<string>("greet", "World");
console.log(msg); // "Hello, World"
```

---

## Real-world example: plugin system

```ts
interface PluginEnv {
  name: string;
  config: Record<string, unknown>;
  log: string[];
}

const bridge = await createLuaBridge();

async function loadPlugin(env: PluginEnv, code: string) {
  const scope = await bridge.useEnvironment(env);

  await scope.execute(`
    function init()
      log[#log + 1] = "Plugin " .. name .. " initialized"
      -- Use config, set up state...
      return true
    end
  `);

  const success = await scope.call<boolean>("init");
  console.log(scope.environment.log); // Plugin state preserved
  return success;
}
```

Each plugin gets its own isolated environment with no risk of interfering with others.

---

## Mounting files in environments

You can mount files that are only available within an environment:

```ts
const scope = await bridge.useEnvironment(env, {
  files: {
    "plugin/helpers.lua": "function normalize(s) return s:lower() end",
  },
});
```

---

## Next

- [Globals](./globals.md) — managing global state
- [Execution](./execution.md) — all the ways to run Lua code
