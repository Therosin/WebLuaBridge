---
title: Error Codes
description: All BridgeError codes with descriptions and common causes
sidebar_position: 3
---

# Error Codes

Every bridge operation that can fail throws a `BridgeError` with a machine-readable `.code` property. Use these codes for programmatic error handling instead of parsing message strings.

---

## Using error codes

```ts
import { BridgeError, ErrorCodes } from "./mod.ts";

try {
  await bridge.execute(badCode);
} catch (err) {
  if (err instanceof BridgeError) {
    switch (err.code) {
      case ErrorCodes.SYNTAX:
        showSyntaxHelp();
        break;
      case ErrorCodes.EXECUTION:
        showLuaTraceback(err.cause);
        break;
      case ErrorCodes.CANCELLED:
        // User cancelled — no action needed
        break;
      default:
        console.error(`Bridge error: ${err.code}`, err.message);
    }
  }
}
```

---

## Execution errors

| Code | Constant | When it happens |
|---|---|---|
| `LUA_EXECUTION_ERROR` | `ErrorCodes.EXECUTION` | Lua code threw a runtime error (`error()`) or execution failed |
| `LUA_SYNTAX_ERROR` | `ErrorCodes.SYNTAX` | Lua code has a syntax error (parse failure) |
| `LUA_CALL_ERROR` | `ErrorCodes.CALL` | `bridge.call()` failed — function not found or invocation error |
| `LUA_FILE_ERROR` | `ErrorCodes.FILE` | File execution failed — missing file or runtime error |
| `LUA_MODULE_ERROR` | `ErrorCodes.MODULE` | `loadModule()` failed |

---

## Global errors

| Code | Constant | When it happens |
|---|---|---|
| `LUA_SET_GLOBAL_ERROR` | `ErrorCodes.SET_GLOBAL` | `Set()` (or deprecated `setGlobal`/`setGlobals`) failed |
| `LUA_GET_GLOBAL_ERROR` | `ErrorCodes.GET_GLOBAL` | `Get()` (or deprecated `getGlobal`) failed |

---

## Environment errors

| Code | Constant | When it happens |
|---|---|---|
| `LUA_ENVIRONMENT_ERROR` | `ErrorCodes.ENVIRONMENT` | `useEnvironment()` failed |

---

## Memory errors

| Code | Constant | When it happens |
|---|---|---|
| `LUA_MEMORY_ERROR` | `ErrorCodes.MEMORY` | Memory operations (get/set cap, usage) failed |

---

## Bridge lifecycle errors

| Code | Constant | When it happens |
|---|---|---|
| `BRIDGE_NOT_INITIALIZED` | `ErrorCodes.NOT_INITIALIZED` | Operation called before `init()` |
| `BRIDGE_START_ERROR` | `ErrorCodes.START` | `start()` failed |
| `BRIDGE_SHUTDOWN_ERROR` | `ErrorCodes.SHUTDOWN` | `shutdown()` failed |
| `BRIDGE_CLOSE_ERROR` | `ErrorCodes.CLOSE` | `close()` failed |

---

## Cancellation

| Code | Constant | When it happens |
|---|---|---|
| `OPERATION_CANCELLED` | `ErrorCodes.CANCELLED` | Operation cancelled via `AbortSignal` |

---

## Error code quick reference

```
LUA_EXECUTION_ERROR     — Lua runtime error
LUA_SYNTAX_ERROR        — Lua parse/syntax error
LUA_CALL_ERROR          — bridge.call() failure
LUA_FILE_ERROR          — file execution failure
LUA_MODULE_ERROR        — loadModule() failure
LUA_ENVIRONMENT_ERROR   — useEnvironment() failure
LUA_SET_GLOBAL_ERROR    — Set/setGlobal/setGlobals failure
LUA_GET_GLOBAL_ERROR    — Get/getGlobal failure
LUA_MEMORY_ERROR        — memory operation failure
BRIDGE_NOT_INITIALIZED  — operation before init()
BRIDGE_START_ERROR      — start() failure
BRIDGE_SHUTDOWN_ERROR   — shutdown() failure
BRIDGE_CLOSE_ERROR      — close() failure
OPERATION_CANCELLED     — AbortSignal cancelled
```
