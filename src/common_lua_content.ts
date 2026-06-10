/**
 * Embedded content of `common.lua` for self-contained bundle compatibility.
 *
 * This module exports the Lua source so it can be mounted without filesystem access.
 * In Deno, the bridge reads the file directly from disk; this provides the fallback.
 */

// Using a raw string with Lua long-bracket equivalent
// escaped for JS string safety
export const COMMON_LUA_SOURCE: string = `local unpack, select = unpack, select;

local function pack(...)
  return { n = select("#", ...), ... }
end

local function unpackn(t)
  return unpack(t, 1, t.n)
end

local function ResolvePath(path)
  local parts = {}
  for part in string.gmatch(path, "[^%.]+") do
    table.insert(parts, part)
  end
  local obj = _G
  for i = 1, #parts - 1 do
    obj = obj[parts[i]]
    if obj == nil then
      error("Invalid path: " .. path)
    end
  end
  return obj, parts[#parts]
end

--- Detours a function at the specified path with optional pre and post callbacks.
--- @param path string dot-separated path to the function to detour (e.g. "math.sin" or "print")
--- @param def {precb: function, postcb: function, catchErrors: boolean} table containing optional pre and post callbacks and error handling flag
--- @return function restore method that can be called to restore the original function
function Detour(path, def)
  local obj, funcname = ResolvePath(path)

  local original = obj[funcname]
  if original == nil then
    error("Function does not exist: " .. path)
  end
  if type(original) ~= "function" then
    error("Object is not a function: " .. path)
  end

  obj[funcname] = function(...)
    local args = pack(...)

    -------------------------------------------------
    -- PRE CALLBACK
    -------------------------------------------------
    if def.precb then
      local pres = pack(pcall(def.precb, unpackn(args)))
      local ok = pres[1]

      if not ok then
        if def.catchErrors then
          print("Error in pre callback for " .. path .. ": " .. tostring(pres[2]))
        else
          error(pres[2])
        end
      else
        if pres.n > 1 and pres[2] == true then
          -- cancel original
          local out = { n = pres.n - 2 }
          for i = 3, pres.n do
            out[i - 2] = pres[i]
          end
          return unpackn(out)
        end
      end
    end

    -------------------------------------------------
    -- ORIGINAL CALL
    -------------------------------------------------
    local ores = pack(pcall(original, unpackn(args)))
    local ok = ores[1]

    if not ok then
      if def.catchErrors then
        print("Error in original function " .. path .. ": " .. tostring(ores[2]))
        return
      else
        error(ores[2])
      end
    end

    local returns = { n = ores.n - 1 }
    for i = 2, ores.n do
      returns[i - 1] = ores[i]
    end

    -------------------------------------------------
    -- POST CALLBACK
    -------------------------------------------------
    if def.postcb then
      local post = pack(pcall(def.postcb, returns, unpackn(args)))
      local ok2 = post[1]

      if not ok2 then
        if def.catchErrors then
          print("Error in post callback for " .. path .. ": " .. tostring(post[2]))
        else
          error(post[2])
        end
      else
        if post.n > 1 and post[2] == true then
          local out = { n = post.n - 2 }
          for i = 3, post.n do
            out[i - 2] = post[i]
          end
          return unpackn(out)
        end
      end
    end

    return unpackn(returns)
  end

  return function()
    obj[funcname] = original
  end
end


--- Wraps a function so that it can only be executed once. Subsequent calls will have no effect.
---@param f function the function to wrap
---@param allowReset boolean if true, the returned function will have a reset method that allows it to be run again
---@return function wrapped function that can only be executed once, and optionally a reset method
---@return function? reset method if allowReset is true, nil otherwise
function OnlyRunOnce(f, allowReset)
    local hasRun = false
    return function(...)
        if not hasRun then
            hasRun = true
            return f(...)
        end
    end, allowReset and function() hasRun = false end or nil
end


function ReadOnly(t)
  return setmetatable({}, {
    __index = t,
    __newindex = function(_, key)
      error("Attempt to modify read-only table")
    end,
    __metatable = false
  })
end

function Class(name, static)
    local class = {}

    return setmetatable({}, {
        __type = name or "Class",
        __index = function(self, key)
            if static and static[key] ~= nil then
                return static[key]
            else
                return class[key]
            end
        end,
        __newindex = function(self, key, value)
            if static and static[key] ~= nil then
                error("Cannot modify static member: " .. key)
            else
                rawset(self, key, value)
            end
        end,
        __metatable = false
    })
end

return {
  Detour = Detour,
  OnlyRunOnce = OnlyRunOnce,
  ReadOnly = ReadOnly,
  Class = Class,
  ResolvePath = ResolvePath,
  pack = pack,
  unpackn = unpackn,
}
`;
