---
title: Exposing JS APIs to Lua
description: Use LuaClass and decorator bindings to make JavaScript APIs callable from Lua
sidebar_position: 6
---

# Exposing JS APIs to Lua

> **Note:** `Set()` is the recommended replacement for `setGlobal()`. Both work for LuaClass installation.

WebLuaBridge gives you two ways to expose JavaScript functionality to Lua:

1. **LuaClass** — a fluent builder for creating Lua tables backed by JS functions
2. **Decorator bindings** — TypeScript `@LuaBinder` / `@LuaBinding` decorators for class-based API modules

---

## LuaClass

`LuaClass` is a builder that creates a Lua table backed by JavaScript functions and values.

### Methods and values

```ts
import { LuaClass } from "./mod.ts";

const cls = new LuaClass({ name: "MyLib" })
  .method("greet", (name: string) => `Hello ${name}!`)
  .method("add", (a: number, b: number) => a + b)
  .value("VERSION", "1.0.0");

bridge.Set("MyLib", cls); // recommended — Set auto-detects LuaClass instances
```

In Lua:
```lua
print(MyLib:greet("World")) -- "Hello World!"
print(MyLib:add(20, 22))    -- 42
print(MyLib.VERSION)        -- "1.0.0"
```

Notice the `:` syntax for methods — Lua automatically passes `self` as the first argument.

### Read-only tables

Prevent Lua from modifying the table:

```ts
const cls = new LuaClass({ name: "Config" })
  .value("debug", true)
  .value("maxRetries", 3)
  .readonly();

bridge.Set("Config", cls);
```

```lua
print(Config.debug)    -- true
Config.debug = false   -- Error: Cannot modify read-only table 'Config'
```

### Callable tables

Make the table itself callable like a function:

```ts
const cls = new LuaClass({ name: "Counter" })
  .call((n: number) => n + 1);

bridge.Set("Counter", cls);
```

```lua
local result = Counter(41) -- 42
```

The explicit handler receives only the Lua arguments; the table itself is not passed as a synthetic JavaScript constructor argument.

### Custom index handler

Intercept reads for keys not in the table:

```ts
const cls = new LuaClass({ name: "Dynamic" })
  .index((self: any, key: string) => {
    if (key === "random") return Math.random();
    return "Unknown key: " .. key;
  });

bridge.Set("Dynamic", cls);
```

```lua
print(Dynamic.random) -- 0.723... (different each time)
print(Dynamic.foo)    -- "Unknown key: foo"
```

### Custom newindex handler

Intercept writes:

```ts
const cls = new LuaClass({ name: "Validator" })
  .newIndex((self: any, key: string, value: any) => {
    if (typeof value !== "number") {
      throw new Error(`Key '${key}' must be a number`);
    }
    self[key] = value;
  });

bridge.Set("Validator", cls);
```

> If you also use `.readonly()`, writes remain rejected instead of reaching the `newIndex` handler. A custom index handler can still supply values for missing reads.

### Manual installation

Instead of `Set()`, install directly on the Lua engine:

```ts
const cls = new LuaClass({ name: "Utils" })
  .method("ping", () => "pong");

await cls.install(luaEngine, "Utils");   // async
cls.installSync(luaEngine, "Utils");     // sync
```

`Set()` does this automatically — manual install is only needed in advanced scenarios.

---

## Decorator bindings

For larger APIs, use `@LuaBinder` and `@LuaBinding` decorators to define modules as TypeScript classes.

`@LuaBinding` works with both decorator conventions — legacy TypeScript decorators (`experimentalDecorators: true`) and TC39 stage-3 decorators (TypeScript's default for modern targets, and what bundlers such as esbuild emit by default). A class decorated with `@LuaBinder` that collects zero `@LuaBinding` methods throws at install time instead of silently registering nothing.

### Defining a binding module

```ts
import { LuaBindings, LuaBinder, LuaBinding } from "./mod.ts";

@LuaBinder({ namespace: "utils" })
class UtilsBindings extends LuaBindings {
  @LuaBinding({ name: "hello" })
  static hello(name: string): string {
    return `Hi ${name}!`;
  }

  @LuaBinding({ name: "double" })
  static double(n: number): number {
    return n * 2;
  }
}
```

### Registering bindings

Create a factory function and pass it to `createLuaBridge()`:

```ts
// my_bindings.ts
export default (ctx: BindingContext) => new UtilsBindings(ctx);

// main.ts
import utilsBindings from "./my_bindings.ts";

const bridge = await createLuaBridge({}, {
  bindings: [utilsBindings],
});
```

In Lua:
```lua
print(utils.hello("World")) -- "Hi World!"
print(utils.double(21))     -- 42
```

### Global-scope bindings (no namespace)

Omit `namespace` to put methods directly in `_G`:

```ts
@LuaBinder({})
class GlobalUtils extends LuaBindings {
  @LuaBinding({ name: "js_type" })
  static jsType(value: unknown): string {
    return typeof value;
  }
}
```

```lua
print(js_type(42))      -- "number"
print(js_type("hello")) -- "string"
```

> `readonly` is **not** supported for namespace-less bindings: Lua has no way to intercept assignment to an existing `_G` key. Configuring `readonly` without a `namespace` throws at install time. To protect an API, give it a namespace.

### Read-only namespaces

```ts
@LuaBinder({ namespace: "config", readonly: true })
class ConfigBindings extends LuaBindings {
  @LuaBinding({ name: "get" })
  static get(key: string): unknown {
    return /* ... */;
  }
}
```

Lua cannot add, overwrite, or remove keys in a read-only namespace:
`config.get = nil` fails just like `config.newKey = 1`. Read-only namespaces are exposed through an empty proxy table backed by a hidden store, so every write is rejected.

### Callable namespaces

Make a namespace callable from Lua through an explicitly designated binding method. This calls the Lua-facing factory; it does not invoke the JavaScript binding class constructor.

```ts
@LuaBinder({ namespace: "mathx" })
class MathBindings extends LuaBindings {
  @LuaCall()
  static create(a: number, b: number): number {
    return a + b;
  }
}
```

```lua
print(mathx(6, 7)) -- 13
```

`@LuaIndex()` and `@LuaNewIndex()` designate handlers for missing-field reads and writes without requiring methods literally named `__index` or `__newindex`. They receive the key (and, for writes, the value); binding instance state remains available through `this`.

### Binding metadata

`bindingDocs(SomeBindings)` returns the class's decorator metadata without constructing the binding or starting Lua. Its structured output can be used by LuaLS, Markdown, or other documentation exporters. The shape of argument and return type descriptors is still intentionally open; values supplied in `args` and `returnType` are carried through for exporters to interpret.

```ts
const docs = bindingDocs(MathBindings);
// docs.namespace, docs.methods, docs.methods[0].args, docs.methods[0].returnType
```

### Multiple binding modules

```ts
const bridge = await createLuaBridge({}, {
  bindings: [
    (ctx) => new MathBindings(ctx),
    (ctx) => new StringBindings(ctx),
    (ctx) => new JsonBindings(ctx),
  ],
});
```

Each module installs into its own namespace (or `_G` if no namespace is given).

### Accessing the bridge from bindings

The `ctx` parameter (`BindingContext`) gives access to the full bridge, including Lua execution and global access:

```ts
@LuaBinder({ namespace: "events" })
class EventBindings extends LuaBindings {
  @LuaBinding({ name: "get_global" })
  static async getGlobal(name: string): Promise<unknown> {
    return await this.ctx.bridge.Get(name);
  }
}
```

Bindings can also use `execute`, `call`, `Set`, and the other public bridge methods through `ctx.bridge`.

### Binding option reference

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | JS method name | Name exposed to Lua |
| `description` | `string` | — | Description for generated documentation |
| `args` | `Array<{name, type}>` | — | Argument metadata for documentation exporters |
| `returnType` | `unknown` | — | Return metadata for documentation exporters |
| `isMethod` | `boolean` | `false` | Documentation metadata for Lua `:` call style |
| `isAsync` | `boolean` | `false` | Documentation metadata indicating the implementation returns a Promise |

```ts
@LuaBinding({ name: "fetch", isAsync: true })
static async fetchData(url: string): Promise<string> {
  const resp = await fetch(url);
  return resp.text();
}
```

### Binding hooks

`@LuaBinder` supports invocation hooks. Hooks receive the Lua method name and the arguments as an array. `after` also receives the binding result, after any returned promise resolves. `error` receives the thrown or rejected error. Hook promises are awaited. If an error hook itself fails, the original binding or hook error is preserved.

```ts
@LuaBinder({
  namespace: "analytics",
  hooks: {
    before: (methodName, args) => {
      console.log(`Before ${methodName}`, args);
    },
    after: (methodName, args, result) => {
      console.log(`After ${methodName}`, args, result);
    },
    error: (methodName, args, error) => {
      console.error(`Failed ${methodName}`, args, error);
    },
  },
})
class AnalyticsBindings extends LuaBindings {
  @LuaBinding({ name: "track" })
  static track(event: string): void {
    // ...
  }
}
```

---

## Choosing between LuaClass and decorators

| You're doing this… | Use |
|---|---|
| Quick one-off API, small utility | `LuaClass` — minimal setup |
| Large API surface, many methods | Decorators — organized and declarative |
| Need namespace isolation | Decorators with `namespace` option |
| Need read-only, callable, or custom index | `LuaClass` — rich metatable control |
| Need before/after hooks on all calls | Decorators with `hooks` option |

---

## Built-in bindings

The project ships binding modules you can register. Import the factories from the package root:

```ts
import {
  createLuaBridge,
  globalBindings,
  jsonBindings,
  regexBindings,
  timersBindings,
} from "./mod.ts";

const bridge = await createLuaBridge({}, {
  bindings: [globalBindings, jsonBindings, regexBindings, timersBindings],
});
```

| Export | Namespace | Functions |
|---|---|---|
| `globalBindings` | `_G` | `js_type()`, `js_len()`, `js_true()`, `js_null()` |
| `jsonBindings` | `json` (read-only) | `stringify()`, `parse()`, `encode()`, `decode()` |
| `regexBindings` | `regex` (read-only) | `match()`, `test()`, `replace()`, `replaceAll()`, `split()` |
| `timersBindings` | `timers` (read-only) | `setTimeout()`, `setInterval()`, `clearTimeout()`, `clearInterval()`, `clearAll()`, `activeCount()` |

Global (`_G`) bindings cannot be read-only — see [Global-scope bindings](#global-scope-bindings-no-namespace).

---

## Related

- [Scoped execution](./scoped-execution.md) — combining bindings with isolated environments
- [Reference: built-in bindings](../reference/built-in-bindings.md)
