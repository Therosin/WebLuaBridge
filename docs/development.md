---
title: Development
description: Building, testing, and contributing to WebLuaBridge
sidebar_position: 6
---

# Development

## Prerequisites

- [Deno](https://deno.com/) v2+
- Git

## Commands

```sh
# Type-check all source files
deno task check

# Run the full test suite
deno task test

# Lint
deno task lint

# Format
deno task fmt

# Build browser bundles (full + minified)
deno task build
deno task bundle
```

## Project structure

```
WebLuaBridge/
├── mod.ts                     # Public entry point
├── browser/entry.ts           # Browser-optimized entry
├── src/
│   ├── lua/
│   │   ├── bridge.ts          # Main LuaBridge class
│   │   ├── types.ts           # TypeScript types
│   │   ├── execution.ts       # Execution service
│   │   ├── environment.ts     # Scoped environments service
│   │   ├── events.ts          # Event bus
│   │   ├── bindings.ts        # LuaBindings + decorators
│   │   ├── lua_class.ts       # LuaClass builder
│   │   ├── errors.ts          # BridgeError + ErrorCodes
│   │   ├── vfs.ts             # Virtual filesystem
│   │   └── utils.ts           # Shared utilities
│   ├── bindings/              # Built-in binding examples
│   │   ├── global.ts
│   │   ├── json.ts
│   │   ├── regex.ts
│   │   └── timers.ts
│   └── common_lua_content.ts  # Embedded Lua utilities
├── examples/                  # Runnable examples
├── tests/                     # Test files (Deno test)
├── docs/                      # Documentation
└── dist/                      # Browser bundles
```

## Architecture

WebLuaBridge follows a service-oriented architecture with dependency injection:

```
LuaBridge (orchestrator)
  ├── VfsRegistry      — virtual filesystem
  ├── ExecutionService — Lua execution, globals, print, memory
  ├── EnvironmentService — scoped execution contexts
  ├── BridgeEventBus   — bidirectional event bus
  ├── LuaBindings      — JS → Lua API exposure
  └── LuaClass         — Lua table builder
```

The `LuaBridge` class composes these services. Each service receives its dependencies via constructor interfaces, making them testable in isolation.

## Testing

Tests live in `tests/` and use Deno's built-in test runner:

```sh
deno task test
```

Test categories:
- **API tests** (`bridge.api.test.ts`) — call, print, Get/Set, reset, memory
- **Binding tests** (`bridge.bindings.test.ts`) — LuaClass, decorators, namespaces
- **Error tests** (`bridge.errors.test.ts`) — BridgeError, error codes
- **Execution tests** (`bridge.execute.test.ts`) — execute, files, modules, args
- **Lifecycle tests** (`bridge.lifecycle.test.ts`) — start/shutdown, idempotency
- **Environment tests** (`bridge.environment-events.test.ts`) — scopes, isolation
- **Cleanup tests** (`bridge.cleanup.test.ts`) — close, timer cleanup, listener survival
- **Abort tests** (`bridge.abort.test.ts`) — AbortSignal integration
- **Unit tests** (`execution.test.ts`, `environment.test.ts`, `vfs.test.ts`)
- **E2E tests** (`examples.e2e.test.ts`) — runs all examples

## CI/CD

The project uses GitHub Actions:

- **CI** (`.github/workflows/ci.yml`): Runs on push/PR — type checks + tests on Deno v2
- **Release** (`.github/workflows/release-assets.yml`): On release — validates, builds, and uploads browser bundles to the GitHub release

## Building the browser bundle

The build script in `scripts/build_bundle.ts`:

1. Locates wasmoon's WASM binary
2. Base64-encodes it as a data URI
3. Runs `deno bundle` with the inlined WASM

```sh
deno task build   # type-check + bundle
deno task bundle  # bundle only
```

Outputs:
- `dist/webluabridge.bundle.js`
- `dist/webluabridge.bundle.min.js`
