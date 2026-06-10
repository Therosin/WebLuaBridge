# WebLuaBridge

Embed a Lua runtime in your TypeScript or JavaScript application — run user scripts, build plugin systems, or add modding support.

Powered by [wasmoon](https://github.com/ceifa/wasmoon) (Lua 5.4 compiled to WebAssembly). Works in Deno, browsers, and any JS runtime that supports WASM.

---

## Features

- **Execute Lua** — run inline scripts or mounted `.lua` files, pass arguments, get typed results
- **Call Lua functions** — invoke named Lua functions from JS with full multi-return support
- **Scoped environments** — isolate script execution to a JS-backed object (plugins, sandboxes)
- **Event bus** — bidirectional JS↔Lua events (`bridge.on/emit`, Lua `Events:On/Emit`)
- **Lifecycle loop** — `start()`/`shutdown()` with `OnInit` / `Update(dt)` / `OnShutdown` hooks
- **Decorator-based bindings** — `@LuaBinder` / `@LuaBinding` TypeScript decorators to expose JS APIs to Lua
- **LuaClass** — builder API for read-only, callable, or custom-indexed Lua tables
- **Print capture** — redirect Lua `print()` output to your own logger
- **Common Lua helpers** — bundled `Detour`, `OnlyRunOnce`, `ReadOnly`, `Class` utilities
- **Browser-ready** — bundle as ESM for in-browser Lua execution

---

## Quick start

```ts
import { createLuaBridge } from "https://raw.githubusercontent.com/Therosin/WebLuaBridge/develop/mod.ts";

const bridge = await createLuaBridge();
try {
  const result = await bridge.execute("return 40 + 2");
  console.log(result); // 42
} finally {
  bridge.close();
}
```

---

## Documentation

All docs are in the [`docs/`](./docs/) folder:

| Topic | File |
|---|---|
| Setup & first steps | [`getting-started.md`](./docs/getting-started.md) |
| Running Lua code | [`execution.md`](./docs/execution.md) |
| Event system | [`events.md`](./docs/events.md) |
| Lifecycle mode | [`lifecycle.md`](./docs/lifecycle.md) |
| Scoped environments | [`environments.md`](./docs/environments.md) |
| Globals & state | [`globals.md`](./docs/globals.md) |
| Bindings & decorators | [`bindings.md`](./docs/bindings.md) |
| Common Lua helpers | [`common-lua.md`](./docs/common-lua.md) |
| Debugging & print | [`debugging.md`](./docs/debugging.md) |
| Browser usage | [`browser.md`](./docs/browser.md) |

---

## Examples

Runnable examples live in [`examples/`](./examples/):

- `basic-run.ts` — create bridge, execute Lua, mount and run a file
- `environment-plugin.ts` — plugin-style scoped execution
- `events-bridge.ts` — bidirectional JS↔Lua events
- `lifecycle-mainloop.ts` — start/shutdown with update loop

Run any example with Deno:

```sh
deno run -A examples/basic-run.ts
```

---

## Development

```sh
deno task check    # type-check
deno task test     # run test suite
deno task build    # check + bundle
```

Vendor bundles are output to `dist/`:
- `dist/webluabridge.bundle.js`
- `dist/webluabridge.bundle.min.js`

---

## License

[GPL-3.0](./LICENSE)
