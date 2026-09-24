---
title: Built-in Bindings
description: Reference for the built-in binding modules — json, regex, timers, and global helpers
sidebar_position: 5
---

# Built-in Bindings

WebLuaBridge ships with ready-made binding modules you can register to give Lua access to JavaScript APIs. The factories (and their classes) are exported from the package root, so no deep imports or extra import-map entries are required.

---

## Registering

Import the shipped factories from `mod.ts` and register them like any other binding factory:

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

The underlying classes (`GlobalBindings`, `JsonBindings`, `RegexBindings`, `TimerBindings`) are exported as well if you need to subclass or reference them.

`json`, `regex`, and `timers` install their namespaces as **read-only**, so authored Lua cannot overwrite or remove their functions. `globalBindings` is the exception: Lua cannot intercept assignment to an existing `_G` key, so global functions cannot be protected — put immutability-critical APIs behind a namespace instead.

---

## Global helpers

**Namespace:** `_G` (no namespace — functions are global)

### js_type(value)

Returns the JavaScript type of a value as a string. Arrays, `Map`s, and `Set`s are distinguished from plain objects.

```lua
print(js_type(42))         -- "number"
print(js_type("hello"))    -- "string"
print(js_type(true))       -- "boolean"
print(js_type({1, 2, 3}))  -- "array"  (indexed Lua tables convert to JS arrays)
print(js_type({}))         -- "object" (string-keyed tables convert to JS objects)
```

### js_len(value)

Returns the length of a value using JavaScript's `.length` property.

```lua
print(js_len("hello"))     -- 5
print(js_len({1, 2, 3}))  -- 3
```

### js_true()

Returns the JavaScript `true` value (distinct from Lua's `true`).

```lua
local t = js_true()
```

### js_null(value)

Returns `true` only when the value is JavaScript `null` (for example, a Lua `nil` that crossed back into JavaScript).

```lua
print(js_null(nil))   -- true
print(js_null(0))     -- false
```

---

## json

**Namespace:** `json`

### json.stringify(value)

Serialize a Lua value to a JSON string.

```lua
local str = json.stringify({ name = "Ada", score = 100 })
-- '{"name":"Ada","score":100}'
```

### json.parse(str)

Parse a JSON string into a Lua table.

```lua
local t = json.parse('{"name":"Ada","score":100}')
print(t.name)  -- "Ada"
```

### json.encode(value)

Alias for `json.stringify()`.

### json.decode(str)

Alias for `json.parse()`.

---

## regex

**Namespace:** `regex`

### regex.match(str, pattern)

Returns the first match of a JavaScript regular expression.

```lua
local result = regex.match("hello world", "hello")
-- "hello"
```

### regex.test(str, pattern)

Returns `true` if the pattern matches anywhere in the string.

```lua
local found = regex.test("hello world", "world")
-- true
```

### regex.replace(str, pattern, replacement)

Replace the first occurrence of the pattern.

```lua
local result = regex.replace("hello world", "world", "Lua")
-- "hello Lua"
```

### regex.replaceAll(str, pattern, replacement)

Replace all occurrences of the pattern.

```lua
local result = regex.replaceAll("a-b-c", "-", "/")
-- "a/b/c"
```

### regex.split(str, pattern)

Split the string by the pattern.

```lua
local parts = regex.split("a,b,c", ",")
-- { "a", "b", "c" }
```

---

## timers

**Namespace:** `timers`

### timers.setTimeout(fn, delayMs)

Call a function after a delay (in milliseconds).

```lua
timers.setTimeout(function()
  print("Delayed hello!")
end, 1000)
```

### timers.setInterval(fn, intervalMs)

Call a function repeatedly at an interval (in milliseconds). Returns an ID usable with `clearTimeout`/`clearInterval`.

```lua
local id = timers.setInterval(function()
  print("Tick...")
end, 500)

-- Later:
timers.clearInterval(id)
```

### timers.clearTimeout(id)

Cancel a pending timeout.

### timers.clearInterval(id)

Cancel a repeating interval.

### timers.clearAll()

Cancel all pending timers and intervals.

```lua
timers.clearAll()
```

### timers.activeCount()

Get the number of currently active timers/intervals.

```lua
local count = timers.activeCount()
print(count .. " active timers")
```
