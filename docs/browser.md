# Browser Usage

WebLuaBridge can run in the browser as an ESM bundle. The Lua runtime is compiled to WebAssembly and included in the bundle.

---

## Building the bundle

```sh
deno task bundle
deno task bundle:min
```

Outputs:
- `dist/webluabridge.bundle.js` — full bundle
- `dist/webluabridge.bundle.min.js` — minified

---

## Self-contained WASM

By default, wasmoon fetches the Lua WASM binary from a CDN at runtime. For self-contained browser bundles, you can embed the WASM as a data URI:

```ts
import { createLuaBridge } from "./dist/webluabridge.bundle.js";

// Embed the WASM binary as a data URI
const wasmBase64 = "data:application/wasm;base64,...";

const bridge = await createLuaBridge({}, {
  wasmUri: wasmBase64,
});
```

The `scripts/build_bundle.ts` script can generate self-contained bundles with the WASM embedded.

---

## Browser entry point

The `browser/entry.ts` file provides a browser-optimized entry point. Import from there instead of `mod.ts` when targeting browsers:

```ts
import { createLuaBridge } from "./browser/entry.ts";
```

---

## Usage in HTML

```html
<script type="module">
  import { createLuaBridge } from "./dist/webluabridge.bundle.min.js";

  const bridge = await createLuaBridge();
  try {
    const result = await bridge.execute("return 'Hello from the browser!'");
    document.body.textContent = result;
  } finally {
    bridge.close();
  }
</script>
```

---

## Limitations

- **No filesystem access** — `mountFile()` works (in-memory virtual filesystem), but you can't read files from disk. Use `mountFile()` or the `files` option to load Lua code.
- **No `Deno` APIs** — the browser bundle uses only standard Web APIs (`fetch`, `setTimeout`, etc.).
- **Main loop uses `setTimeout`** — the update loop runs on the browser's event loop via `setTimeout`. Long-running Lua code blocks the UI.

---

## Performance considerations

- Lua runs in a Web Worker for non-blocking execution (the default `setTimeout`-based loop runs on the main thread).
- The WASM binary is ~300KB gzipped. Embedding it as a data URI adds ~33% overhead (base64 encoding).
- Memory limits are especially important in browsers — set a cap with `bridge.setMemoryMax()` to prevent excessive memory use.

---

## Next

- [Getting started](./getting-started.md) — full setup guide
- [Debugging](./debugging.md) — capturing Lua output
