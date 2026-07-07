---
title: Common Lua Helpers
description: Reference for the bundled Lua utility library — Detour, OnlyRunOnce, ReadOnly, Class
sidebar_position: 4
---

# Common Lua Helpers

WebLuaBridge bundles a Lua utility library in `common.lua`. Load it into your bridge to use these helpers from Lua.

---

## Loading

```ts
const bridge = await createLuaBridge();

// Load as a module for require("common")
await bridge.loadCommon();

// Or: load and inject helpers into _G
await bridge.loadCommon(true);
```

With `loadCommon(true)`, the helpers become available as global functions.

---

## Detour(path, spec)

Hook into any global Lua function with pre/post callbacks — useful for monitoring, debugging, or modifying behavior at runtime.

```lua
local restore = Detour("print", {
  precb = function(...)
    -- Called before the original
    print("[LOG] About to print: " .. tostring(...))
  end,
  postcb = function(results, ...)
    -- Called after the original
  end,
  catchErrors = true, -- catch errors instead of throwing
})
```

**Parameters:**
- `path` — dot-separated path to the function (e.g., `"math.sin"`, `"print"`)
- `spec` — table with optional fields: `precb`, `postcb`, `catchErrors`

**Return:** A `restore()` function that undoes the hook.

### Cancelling the original call

Return `true` as the second value from `precb`:

```lua
Detour("print", {
  precb = function(msg)
    if msg == "secret" then
      return true  -- cancel, don't print "secret"
    end
  end
})
```

### Full example

```lua
local restore = Detour("print", {
  precb = function(...)
    print("[Hook] Intercepted: " .. tostring(...))
  end,
  postcb = function(results, ...)
    print("[Hook] Original returned:", results)
  end,
  catchErrors = true,
})

print("hello")  -- [Hook] Intercepted: hello → hello → [Hook] Original returned:
restore()       -- undo the hook
```

---

## OnlyRunOnce(fn, allowReset?)

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
local once = OnlyRunOnce(function()
  print("Ran!")
end, true)

once()    -- "Ran!"
once()    -- (nothing)
once.reset()  -- reset the guard
once()    -- "Ran!"
```

---

## ReadOnly(table)

Create a read-only proxy for any table. Reads work normally; writes throw an error.

```lua
local data = { x = 10, y = 20 }
local ro = ReadOnly(data)

print(ro.x)   -- 10
ro.x = 99     -- Error: Attempt to modify read-only table
```

The original `data` table remains mutable — `ReadOnly` creates a proxy with a `__newindex` guard.

---

## Class(name, static?)

Simple OOP class builder using metatable-based inheritance.

```lua
local Animal = Class("Animal")

function Animal:speak()
  return "..."
end

-- Inheritance
local Dog = Class("Dog", Animal)

function Dog:speak()
  return "Woof!"
end

local dog = Dog()
print(dog:speak())  -- "Woof!"
```

### Static members

```lua
local Counter = Class("Counter", {
  -- Static members (cannot be overwritten on instances)
  count = 0,
})

function Counter:init()
  self.id = Counter.count
  Counter.count = Counter.count + 1
end

local a = Counter()
local b = Counter()
print(a.id, b.id)    -- 0, 1
print(Counter.count)  -- 2
```

### `init()` convention

If a class defines `init()`, it's called automatically on construction with any arguments:

```lua
local Player = Class("Player")

function Player:init(name, hp)
  self.name = name
  self.hp = hp
end

local p = Player("Ada", 100)
print(p.name)  -- "Ada"
```

---

## pack(...) / unpackn(t)

Tuple packing utilities for working with multiple return values.

```lua
local t = pack(1, 2, 3)    -- { 1, 2, 3, n = 3 }
local a, b, c = unpackn(t) -- 1, 2, 3
```

`pack` creates a table with a `.n` field tracking the original count. `unpackn` reverses the operation.

---

## ResolvePath(path)

Resolve a dot-separated path to a table and final key. Used internally by `Detour`.

```lua
local obj, key = ResolvePath("math.sin")
-- obj = math, key = "sin"
```
