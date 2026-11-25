---
title: Game Scripting with Lua
description: Build a game loop with Lua-scripted entities using lifecycle hooks and scoped environments
sidebar_position: 2
---

# Game Scripting with Lua

This tutorial builds a simple game simulation where Lua scripts control entity behavior through the lifecycle system. Each entity runs in its own environment with access to a game API.

---

## Step 1: Set up the game world

```ts
// game.ts
import { createLuaBridge } from "./mod.ts";

interface Entity {
  name: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
}

interface GameState {
  time: number;
  entities: Entity[];
  eventLog: string[];
}
```

## Step 2: Create the game bridge

```ts
const bridge = await createLuaBridge({
  game: {
    time: 0,
    entities: [],
    eventLog: [],
  },
});

// Listen for entity events
bridge.on("entity:damage", (name: string, amount: number, source: string) => {
  console.log(`${name} took ${amount} damage from ${source}`);
});

bridge.on("entity:death", (name: string) => {
  console.log(`${name} has been defeated!`);
});
```

## Step 3: Write the init script

```lua
-- init.lua
function OnInit()
  game.entities = {
    { name = "Hero", hp = 100, maxHp = 100, x = 0, y = 0 },
    { name = "Goblin", hp = 30, maxHp = 30, x = 10, y = 10 },
    { name = "Slime", hp = 15, maxHp = 15, x = -5, y = -5 },
  }
  table.insert(game.eventLog, "World initialized with " .. #game.entities .. " entities")
end

function getAliveEntities()
  local alive = {}
  for _, e in ipairs(game.entities) do
    if e.hp > 0 then
      table.insert(alive, e)
    end
  end
  return alive
end

function applyDamage(target, amount, source)
  local previous = target.hp
  target.hp = math.max(0, target.hp - amount)
  local dealt = previous - target.hp

  Events:Emit("entity:damage", target.name, dealt, source)

  if target.hp == 0 then
    Events:Emit("entity:death", target.name)
  end

  return dealt
end

function Update(dt)
  game.time = game.time + dt
  local alive = getAliveEntities()

  for _, e in ipairs(alive) do
    -- Regenerate health slowly
    if e.hp < e.maxHp then
      e.hp = math.min(e.maxHp, e.hp + dt * 2)
    end
  end

  -- Goblins attack the hero periodically
  for _, e in ipairs(alive) do
    if e.name == "Goblin" then
      local hero = game.entities[1]
      if hero and hero.hp > 0 then
        applyDamage(hero, dt * 5, "Goblin")
      end
    end
  end
end

function OnShutdown()
  local elapsed = math.floor(game.time)
  local alive = getAliveEntities()
  print("=== Session Over ===")
  print("Elapsed time: " .. elapsed .. "s")
  print("Survivors: " .. #alive)
  for _, e in ipairs(alive) do
    print("  " .. e.name .. " (" .. math.floor(e.hp) .. " HP)")
  end
end
```

## Step 4: Mount and start

```ts
await bridge.mountFile("init.lua", initScript);
await bridge.start({ intervalMs: 100 });

// Let the simulation run
await new Promise(r => setTimeout(r, 2000));

// Check the game state
const entities = await bridge.Get<Entity[]>("game.entities");
console.log("Final state:");
for (const e of entities!) {
  console.log(`  ${e.name}: ${Math.floor(e.hp)}/${e.maxHp} HP at (${e.x}, ${e.y})`);
}

await bridge.shutdown();
```

## Step 5: Scripted abilities

Add Lua-defined abilities that call back into custom bindings:

```ts
// Create ability bindings
import { LuaBindings, LuaBinder, LuaBinding } from "./mod.ts";

@LuaBinder({ namespace: "abilities" })
class AbilityBindings extends LuaBindings {
  @LuaBinding({ name: "heal" })
  static heal(target: any, amount: number): number {
    const previous = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    return target.hp - previous;
  }

  @LuaBinding({ name: "teleport" })
  static teleport(target: any, x: number, y: number): void {
    target.x = x;
    target.y = y;
  }
}

// Register when creating the bridge
const bridge = await createLuaBridge({ game: gameState }, {
  bindings: [(ctx) => new AbilityBindings(ctx)],
});
```

From Lua, entities can now use abilities:

```lua
function Update(dt)
  -- Hero healing aura
  for _, e in ipairs(getAliveEntities()) do
    if e.name == "Hero" then
      for _, ally in ipairs(getAliveEntities()) do
        if ally ~= e then
          abilities.heal(ally, dt * 3)
        end
      end
    end
  end
end
```

## Full runnable example

```ts
import { createLuaBridge, LuaBindings, LuaBinder, LuaBinding } from "./mod.ts";

// ── Bindings ──
@LuaBinder({ namespace: "fx" })
class FxBindings extends LuaBindings {
  @LuaBinding({ name: "damage" })
  static damage(target: any, amount: number): number {
    const dealt = Math.min(target.hp, amount);
    target.hp -= dealt;
    return dealt;
  }
}

// ── Setup ──
const bridge = await createLuaBridge({
  game: { time: 0, events: [] as string[] },
}, {
  bindings: [(ctx) => new FxBindings(ctx)],
});

// ── Mount game script ──
await bridge.mountFile("init.lua", `
  function OnInit()
    game.hero = { name = "Ada", hp = 100, maxHp = 100 }
    game.monsters = {
      { name = "Goblin", hp = 30, maxHp = 30 },
      { name = "Slime", hp = 20, maxHp = 20 },
    }
    table.insert(game.events, "Game started!")
  end

  function Update(dt)
    game.time = game.time + dt

    -- Monsters attack hero
    for _, m in ipairs(game.monsters) do
      if m.hp > 0 then
        fx.damage(game.hero, dt * 3)
      end
    end

    -- Check game over
    if game.hero.hp <= 0 then
      table.insert(game.events, "Game over after " .. math.floor(game.time) .. "s")
      -- Stop somehow — in practice you'd emit an event
    end
  end

  function OnShutdown()
    print("Hero HP: " .. math.floor(game.hero.hp))
    print("Monsters alive: " .. #game.monsters)
    print("Events: " .. table.concat(game.events, ", "))
  end
`);

// ── Run ──
await bridge.start({ intervalMs: 50 });
await new Promise(r => setTimeout(r, 1000));
await bridge.shutdown();
bridge.close();
```

## Key takeaways

- **Lifecycle hooks** (`OnInit` → `Update(dt)` → `OnShutdown`) structure your game loop
- **Global state** in `_G` is shared between all Lua code in the bridge
- **Custom bindings** let Lua call into JS for operations like damage calculations
- **Events** keep your systems decoupled — entities emit, the host listens
