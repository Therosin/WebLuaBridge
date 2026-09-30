/** Lua source installed in every WebLuaBridge runtime. */
export const ASYNC_LUA_SOURCE = `
function async(callback)
  assert(type(callback) == "function", "async expects a function")

  return function(...)
    local co = coroutine.create(callback)
    local args = table.pack(...)

    return Promise.create(function(resolve, reject)
      local safe, result

      local function step()
        if coroutine.status(co) == "dead" then
          local send = safe and resolve or reject
          return send(result)
        end

        safe, result = coroutine.resume(co)
        if not safe then
          return reject(result)
        end

        if coroutine.status(co) == "dead" then
          return resolve(result)
        end

        if safe and result == Promise.resolve(result) then
          result:finally(step):catch(function() end)
        else
          step()
        end
      end

      safe, result = coroutine.resume(co, table.unpack(args, 1, args.n))
      if not safe then
        return reject(result)
      end
      if coroutine.status(co) == "dead" then
        return resolve(result)
      end

      result:finally(step):catch(function() end)
    end)
  end
end
`;
