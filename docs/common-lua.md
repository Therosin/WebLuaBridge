# Common Lua Helpers

WebLuaBridge bundles a set of Lua utility functions in `common.lua`. Load them into your bridge to use them from Lua.

---

## Loading the helpers

```ts
const bridge = await createLuaBridge();
try {
  // Load as the "common" module
  await bridge.loadCommon();

  // Or: load and inject into _G
  await bridge.loadCommon(true);
} finally {
  bridge.close();
}
```

With `loadCommon()`, helpers are available via `require("common")`. With `loadCommon(true)`, selected helpers are also injected as `_G` globals.

---

## Available helpers

### `Detour(path, def)`

Hook into any global Lua function with pre/post callbacks. Similar to runtime patching.

```lua
local restore = Detour("print", {
  precb = function(...)
    -- Called before the original print
    print("[LOG] About to print: " .. tostring(...))
  end,
  postcb = function(results, ...)
    -- Called after the original print
    -- results: what the original returned
    -- ...: the original arguments
  end,
  catchErrors = true, -- catch errors instead of throwing
})
```

The `precb` can cancel the original call by returning `true` as its second value:

```lua
Detour("print", {
  precb = function(msg)
    if msg == "secret" then
      return true  -- cancel, don't print "secret"
    end
  end
})
```

`Detour` returns a `restore` function to undo the hook:

```lua
restore()  -- original print is back
```

### `OnlyRunOnce(fn, allowReset?)`

Wrap a function so it executes only once. Subsequent calls are ignored.

```lua
local init = OnlyRunOnce(function()
  print("Initializing...")
end)

init()  -- "Initializing..."
init()  -- (nothing happens)
init()  -- (nothing happens)
```

With `allowReset = true`, the returned function has a `.reset()` method:

```lua
local once, reset = OnlyRunOnce(function()
  print("Ran!")
end, true)

once()   -- "Ran!"
once()   -- (nothing)
reset()  -- allows it to run again
once()   -- "Ran!"
```

### `ReadOnly(table)`

Create a read-only proxy for any table. Reads work normally; writes throw an error.

```lua
local data = { x = 10, y = 20 }
local ro = ReadOnly(data)

print(ro.x)   -- 10
ro.x = 99     -- Error: Attempt to modify read-only table
```

### `Class(name, static?)`

Simple OOP class builder. Creates a table with metatable-based inheritance.

```lua
local Animal = Class("Animal", {
  -- Static members (shared across instances, cannot be overwritten)
  count = 0,
})

function Animal:speak()
  return "..."
end

local Dog = Class("Dog", {
  bark = function(self)
    return "Woof!"
  end,
})

local dog = Dog()
dog.name = "Rex"
print(dog:bark())  -- "Woof!"
```

Static members are inherited but cannot be modified on instances.

### `pack(...)` / `unpackn(t)`

Tuple packing utilities for working with multiple return values:

```lua
local t = pack(1, 2, 3)   -- { 1, 2, 3, n = 3 }
local a, b, c = unpackn(t) -- 1, 2, 3
```

### `ResolvePath(path)`

Resolve a dot-separated path to a table and final key. Used internally by `Detour`:

```lua
local obj, key = ResolvePath("math.sin")
-- obj = math, key = "sin"
```

---

## Next

- [Bindings](./bindings.md) — exposing JS APIs to Lua
- [Debugging](./debugging.md) — capturing print output and inspecting state
