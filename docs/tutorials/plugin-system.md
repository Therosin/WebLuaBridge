---
title: Building a Plugin System
description: Create a Lua modding host where plugins run in isolated environments with controlled APIs
sidebar_position: 1
---

# Building a Plugin System

This tutorial walks through building a plugin host that loads Lua scripts as isolated plugins. Each plugin gets:

- Its own environment object (no data leaking between plugins)
- A controlled API (only what we choose to expose)
- Event-based communication with the host

---

## Step 1: Define the plugin API

Start with the TypeScript types and the API object we'll expose to Lua:

```ts
// plugin_host.ts
import { createLuaBridge } from "./mod.ts";

interface PluginAPI {
  log: (message: string) => void;
  getData: (key: string) => unknown;
  setData: (key: string, value: unknown) => void;
}

interface Plugin {
  name: string;
  env: {
    api: PluginAPI;
    config: Record<string, unknown>;
  };
}
```

## Step 2: Create the plugin loader

```ts
class PluginHost {
  private bridge = await createLuaBridge();
  private plugins: Map<string, Plugin> = new Map();

  async loadPlugin(
    name: string,
    code: string,
    config: Record<string, unknown> = {},
  ): Promise<void> {
    const plugin: Plugin = {
      name,
      env: {
        api: {
          log: (msg) => this.onPluginLog(name, msg),
          getData: (key) => this.data.get(key),
          setData: (key, value) => this.data.set(key, value),
        },
        config,
      },
    };

    const scope = await this.bridge.useEnvironment(plugin.env);

    try {
      await scope.execute(code);
      const ok = await scope.call<boolean>("init");
      if (ok) {
        this.plugins.set(name, plugin);
        this.bridge.emit("plugin:loaded", name);
      }
    } catch (err) {
      this.bridge.emit("plugin:error", name, String(err));
    }
  }

  private data = new Map<string, unknown>();

  private onPluginLog(name: string, msg: string) {
    console.log(`[${name}] ${msg}`);
  }
}
```

## Step 3: Write a plugin

Plugins define an `init()` function that receives their environment:

```lua
-- plugins/greeter.lua
function init()
  api.log("Greeter plugin starting up...")
  api.setData("greeting", "Hello from Lua!")
  return true
end

function greet(name)
  local base = api.getData("greeting")
  return base .. " " .. name
end
```

```lua
-- plugins/scorer.lua
function init()
  api.log("Scorekeeper ready")
  scores = {}
  return true
end

function recordScore(player, points)
  if not scores[player] then
    scores[player] = 0
  end
  scores[player] = scores[player] + points
  api.log(player .. " now has " .. scores[player])
end
```

## Step 4: Load and interact with plugins

```ts
const host = new PluginHost();

// Load plugins
await host.loadPlugin("greeter", `
  function init()
    api.log("Greeter started!")
    return true
  end
`, { language: "en" });

await host.loadPlugin("scorer", `
  function init()
    api.log("Scorer ready!")
    return true
  end
`);

// Listen for plugin events
host.bridge.on("plugin:loaded", (name: string) => {
  console.log(`Plugin loaded: ${name}`);
});
```

## Step 5: Call plugin functions from JS

After loading, you can call into plugin code through the scope:

```ts
// Keep track of scopes per plugin
const pluginScopes = new Map<string, LuaExecutionContext>();

// In loadPlugin, after creating the scope:
pluginScopes.set(name, scope);

// Later, call a specific plugin function:
const scope = pluginScopes.get("greeter");
if (scope) {
  const result = await scope.call<string>("greet", "World");
  console.log(result); // "Hello from Lua! World"
}
```

## Complete example

Here's the full plugin host:

```ts
import { createLuaBridge, LuaExecutionContext } from "./mod.ts";

type PluginID = string;

interface PluginAPI {
  log: (msg: string) => void;
  getData: (key: string) => unknown;
  setData: (key: string, value: unknown) => void;
}

class PluginSystem {
  bridge = await createLuaBridge();
  private scopes = new Map<PluginID, LuaExecutionContext>();
  private data = new Map<string, unknown>();

  async register(id: PluginID, code: string, config = {}) {
    const env = {
      api: {
        log: (msg: string) => console.log(`[${id}] ${msg}`),
        getData: (key: string) => this.data.get(key),
        setData: (key: string, value: unknown) => this.data.set(key, value),
      },
      config,
    };

    const scope = await this.bridge.useEnvironment(env);
    await scope.execute(code);

    const ok = await scope.call<boolean>("init");
    if (ok) {
      this.scopes.set(id, scope);
      this.bridge.emit("plugin:loaded", id);
    }
    return ok;
  }

  async call<T>(id: PluginID, fn: string, ...args: unknown[]): Promise<T> {
    const scope = this.scopes.get(id);
    if (!scope) throw new Error(`Plugin not found: ${id}`);
    return scope.call<T>(fn, ...args);
  }

  async unload(id: PluginID) {
    await this.call(id, "shutdown");
    this.scopes.delete(id);
    this.bridge.emit("plugin:unloaded", id);
  }
}

// Usage
const system = new PluginSystem();

await system.register("printer", `
  function init()
    api.log("ready")
    return true
  end
  function print(msg)
    api.log(msg)
  end
`);

await system.call("printer", "print", "Hello from plugin!");

// Plugins don't interfere with each other
await system.register("counter", `
  local count = 0
  function init()
    api.log("counter started at " .. count)
    return true
  end
  function tick()
    count = count + 1
    return count
  end
`);

console.log(await system.call("counter", "tick")); // 1
console.log(await system.call("counter", "tick")); // 2
```

## Key takeaways

- **Isolation:** each plugin's `useEnvironment()` scope prevents data leaks
- **Controlled APIs:** plugins only access what you put in their environment
- **Event-driven:** plugins and host communicate through the shared event bus
- **Type-safe:** TypeScript types keep your API contracts clean
