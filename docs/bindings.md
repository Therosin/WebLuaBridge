# Bindings

Bindings are how you expose JavaScript APIs to Lua. WebLuaBridge provides two systems:

1. **LuaClass** — a builder API for creating Lua tables with methods, values, and metatable behaviors
2. **Decorator bindings** — TypeScript `@LuaBinder` / `@LuaBinding` decorators for class-based API modules

---

## LuaClass

`LuaClass` is a builder that creates a Lua table backed by JavaScript functions and values.

### Basic usage

```ts
import { LuaClass } from "./mod.ts";

const cls = new LuaClass({ name: "MyLib" })
  .method("greet", (name: string) => `Hello ${name}!`)
  .method("add", (a: number, b: number) => a + b)
  .value("VERSION", "1.0.0");

bridge.setGlobal("MyLib", cls);
```

In Lua:
```lua
print(MyLib:greet("World"))  -- "Hello World!"
print(MyLib:add(20, 22))     -- 42
print(MyLib.VERSION)         -- "1.0.0"
```

### Read-only tables

Prevent Lua from modifying the table:

```ts
const cls = new LuaClass({ name: "Config" })
  .value("debug", true)
  .value("maxRetries", 3)
  .readonly();

bridge.setGlobal("Config", cls);
```

In Lua:
```lua
print(Config.debug)       -- true
Config.debug = false      -- Error: Cannot modify read-only table 'Config'
```

### Callable tables

Make the table itself callable (like a function):

```ts
const cls = new LuaClass({ name: "Counter" })
  .method("__call", (self: any, n: number) => n + 1)
  .callable();

bridge.setGlobal("Counter", cls);
```

In Lua:
```lua
local result = Counter(41)  -- 42
```

The `__call` method receives `self` as the first argument.

### Custom `__index` handler

Intercept reads for keys not in the table:

```ts
const cls = new LuaClass({ name: "Dynamic" })
  .index((self: any, key: string) => {
    if (key === "random") return Math.random();
    return `Unknown key: ${key}`;
  });

bridge.setGlobal("Dynamic", cls);
```

In Lua:
```lua
print(Dynamic.random)  -- 0.723... (different each time)
print(Dynamic.foo)     -- "Unknown key: foo"
```

### Custom `__newindex` handler

Intercept writes:

```ts
const cls = new LuaClass({ name: "Validator" })
  .newIndex((self: any, key: string, value: any) => {
    if (typeof value !== "number") {
      throw new Error(`Key '${key}' must be a number`);
    }
    self[key] = value;
  });

bridge.setGlobal("Validator", cls);
```

**Note:** If you also use `.readonly()`, the readonly guard takes priority.

### Installing manually

Instead of `setGlobal()`, you can install a LuaClass directly:

```ts
const cls = new LuaClass({ name: "Utils" })
  .method("ping", () => "pong");

await cls.install(luaEngine, "Utils");   // async
cls.installSync(luaEngine, "Utils");     // sync
```

`setGlobal()` does this automatically — you only need manual install in advanced scenarios.

---

## Decorator Bindings

For larger APIs, use `@LuaBinder` and `@LuaBinding` decorators to define modules as TypeScript classes.

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

Export a factory function and pass it to `createLuaBridge()`:

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
print(utils.hello("World"))  -- "Hi World!"
print(utils.double(21))      -- 42
```

### Global-scope bindings (no namespace)

Omit `namespace` in `@LuaBinder` to put methods directly in `_G`:

```ts
@LuaBinder({})
class GlobalUtils extends LuaBindings {
  @LuaBinding({ name: "js_type" })
  static jsType(value: unknown): string {
    return typeof value;
  }
}
```

In Lua:
```lua
print(js_type(42))       -- "number"
print(js_type("hello"))  -- "string"
```

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

Lua cannot add or modify keys in a read-only namespace.

### Multiple binding modules

Pass multiple factories:

```ts
const bridge = await createLuaBridge({}, {
  bindings: [
    (ctx) => new MathBindings(ctx),
    (ctx) => new StringBindings(ctx),
    (ctx) => new JsonBindings(ctx),
  ],
});
```

Each module installs into its own namespace (or `_G`).

### Accessing the bridge from bindings

The `ctx` parameter (typed as `BindingContext`) gives you access to the bridge instance:

```ts
@LuaBinder({ namespace: "events" })
class EventBindings extends LuaBindings {
  @LuaBinding({ name: "fire" })
  static fire(event: string, data: unknown): void {
    this.ctx.bridge.emit(event, data);
  }
}
```

### Binding options

| Option | Type | Description |
|---|---|---|
| `name` | `string` | Name exposed to Lua (defaults to JS method name) |
| `isMethod` | `boolean` | First argument is `self` (Lua `:` syntax) |
| `isAsync` | `boolean` | Binding returns a Promise |

```ts
@LuaBinding({ name: "fetch", isAsync: true })
static async fetchData(url: string): Promise<string> {
  const resp = await fetch(url);
  return resp.text();
}
```

---

## Built-in bindings

The project includes example binding modules in `src/bindings/`:

- `global.ts` — `js_type()`, `js_len()`, `js_true()` functions in `_G`
- `json.ts` — `json.stringify()` / `json.parse()` / `json.encode()` / `json.decode()`
- `regex.ts` — `regex.match()` / `regex.test()` / `regex.replace()` / `regex.replaceAll()` / `regex.split()`
- `timers.ts` — `timers.setTimeout()` / `timers.setInterval()` / `timers.clearTimeout()` / `timers.clearInterval()` / `timers.clearAll()` / `timers.activeCount()`

Import and register them like any other binding factory.

---

## Next

- [Common Lua helpers](./common-lua.md) — bundled Lua utilities
- [Execution](./execution.md) — running Lua code
