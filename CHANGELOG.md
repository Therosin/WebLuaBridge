# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CI pipeline via GitHub Actions (`deno check` + `deno test` + `deno lint`)
- `package.json` for npm ecosystem compatibility
- `.editorconfig` for consistent editor settings
- `Get()` / `Set()` unified access API — auto-detects flat vs dotted paths
- `GetFunction()` typed callable handles to Lua functions
- `GetMethod()` self-binding method handles for Lua `obj:method()` calling convention
- `SetFunction()` / `SetMethod()` convenience wrappers for exposing JS functions to Lua
- `ctx.Get()` / `ctx.Set()` renamed from `ctx.get()` / `ctx.set()`
- Shipped bindings are now exported from `mod.ts`: `globalBindings`, `jsonBindings`, `regexBindings`, `timersBindings`, and their `*Bindings` classes
- `js_null()` global helper; `js_type()` now distinguishes arrays, `Map`s, and `Set`s
- TC39 stage-3 decorator support for `@LuaBinding` (in addition to legacy `experimentalDecorators`)

### Changed

- `regex` binding operations now take the subject string first: `regex.match(str, pattern)`, `regex.replace(str, pattern, replacement)` — matching Lua's `string.find(str, pattern)` and JavaScript's `str.match(pattern)`
- `json`, `regex`, and `timers` namespaces install as read-only
- `LuaClass.readonly()` now rejects overwriting or removing existing keys, not just adding new ones
- Source imports use `npm:wasmoon@1.16.0` directly so consumer bundlers (esbuild) no longer need a `wasmoon` import-map entry
- TypeScript strict mode enabled (`strict: true`, `noImplicitAny: true`)
- Build pipeline migrated from deprecated `deno bundle` to esbuild
- `null` from wasmoon normalized to `undefined` in `Get()` for consistency

### Fixed

- `@LuaBinder` classes that collect zero `@LuaBinding` methods now throw at install time instead of silently registering nothing
- Configuring `readonly` without a `namespace` now throws instead of being a silent no-op

### Deprecated

- `getGlobal()` → use `Get()`
- `setGlobal()` → use `Set()`
- `setGlobals()` → use `Set()` (individual calls)
- `getDeep()` → use `Get()`
- `setDeep()` → use `Set()`
- `setField()` → use `Set("table.field", value)`
- `ctx.get()` / `ctx.set()` → use `ctx.Get()` / `ctx.Set()`

## [0.1.0] — 2026-06-18

### Added

- Initial release
- `createLuaBridge()` / `LuaBridge` class
- `runLuaCode()` convenience function
- Lua execution: `execute()`, `call()`, `executeFile()`
- Scoped environments via `useEnvironment()`
- Decorator-based bindings: `@LuaBinder` / `@LuaBinding`
- `LuaClass` fluent builder
- Bidirectional event bus (JS ↔ Lua)
- Lifecycle loop: `start()` / `shutdown()` with `OnInit`, `Update(dt)`, `OnShutdown`
- Print capture via `onPrint()`
- Memory management: `getMemoryUsed()`, `setMemoryMax()`
- Virtual filesystem via `mountFile()`
- Common Lua helpers: `Detour`, `OnlyRunOnce`, `ReadOnly`, `Class`
- Built-in binding examples: `json`, `regex`, `timers`, `global`
- Browser ESM bundle via `deno bundle`
- TypeScript generics for typed globals and events
- Error codes system (`BridgeError` + `ErrorCodes`)
- Deep path get/set: `bridge.getDeep()` / `bridge.setDeep()`
- Synchronous execution: `executeRaw()`, `executeFileRaw()`
- Module loading via `loadModule()`
- Debug stack dump via `dumpStack()`
