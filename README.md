
## WebLuaBridge

Lua runtime bridge built on wasmoon, with:
- env-scoped execution (`useEnvironment`)
- bridge event bus (`on/off/emit` and Lua `Events:On/Off/Emit`)
- lifecycle loop (`start`/`shutdown` with `OnInit`/`Update(dt)`/`OnShutdown`)

## Deno Import (GitHub URL)

This repo now exposes a Deno entrypoint at `mod.ts`.

Example from another Deno project:

```ts
import { createLuaBridge } from "https://raw.githubusercontent.com/<owner>/<repo>/<ref>/mod.ts";

const bridge = await createLuaBridge();
try {
  const result = await bridge.execute("return 40 + 2");
  console.log(result); // 42
} finally {
  bridge.close();
}
```

Use a pinned tag/commit for production imports.

## Deno Tasks

```sh
deno task check
deno task test
deno task build
```

## Runtime

This project is Deno-only.

## Vendor Bundle

Build vendor-ready ESM artifacts (no Node packaging):

```sh
deno task bundle
deno task bundle:min
```

Outputs:
- `dist/webluabridge.bundle.js`
- `dist/webluabridge.bundle.min.js`
