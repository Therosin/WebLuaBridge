---
title: Guides
description: Task-oriented guides for using WebLuaBridge
sidebar_position: 2
---

# Guides

Learn how to use WebLuaBridge by doing. Each guide focuses on a specific task.

## Core topics

| Guide | What you'll learn |
|---|---|
| [Running Lua code](./running-lua.md) | All execution methods: `execute`, `call`, files, modules, sync |
| [Sharing data](./sharing-data.md) | Set and read globals, deep path access, type safety |
| [Scoped execution](./scoped-execution.md) | Plugin isolation with `useEnvironment()` |
| [Event system](./event-system.md) | Bidirectional JS ↔ Lua events |
| [Lifecycle loop](./lifecycle.md) | Game/update loop with `start()` and `shutdown()` |

## Advanced topics

| Guide | What you'll learn |
|---|---|
| [Exposing JS APIs](./exposing-js-apis.md) | `LuaClass` builder and `@LuaBinder` decorators |
| [Browser deployment](./browser.md) | ESM bundle, self-contained WASM, browser caveats |

## Reference

Once you're familiar with the guides, the [reference section](../reference/README.md) has the full API docs, configuration options, and error codes.
