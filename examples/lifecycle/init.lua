ticks = 0

function OnInit()
    print("[Lua] OnInit from " .. tostring(hostName))
end

function Update(dt)
    ticks = ticks + 1
    print(string.format("[Lua] Update tick=%d dt=%.3f", ticks, dt))
end

function OnShutdown()
    print("[Lua] OnShutdown ticks=" .. tostring(ticks))
end
