---
title: Browser Deployment
description: Use WebLuaBridge in the browser with the ESM bundle and self-contained WASM
sidebar_position: 7
---

# Browser Deployment

WebLuaBridge runs in any browser with WebAssembly support. The Lua runtime ships as part of your ESM bundle — no separate files to load.

---

## Build the bundle

```sh
deno task bundle    # full bundle → dist/webluabridge.bundle.js
deno task bundle:min # minified → dist/webluabridge.bundle.min.js
```

The bundle includes wasmoon's Lua 5.4 WASM binary as an inlined data URI — it's self-contained with no external dependencies.

---

## Use in HTML

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

### Passing a custom WASM URI

If you want to serve the WASM binary separately instead of inlining:

```ts
const wasmUrl = new URL("./lua.wasm", import.meta.url).href;

const bridge = await createLuaBridge({}, {
  wasmUri: wasmUrl,
});
```

---

## Browser entry point

The `browser/entry.ts` file provides a browser-optimized entry. Import from there when targeting browsers:

```ts
import { createLuaBridge } from "./browser/entry.ts";
```

---

## Limitations

| Limitation | Workaround |
|---|---|
| No filesystem access | Use `mountFile()` or the `files` option for in-memory files |
| No `Deno` APIs | The bundle uses only standard Web APIs (`fetch`, `setTimeout`) |
| Long Lua code blocks UI | Keep individual operations short |
| WASM binary adds bundle size | ~300KB gzipped; ~400KB base64-encoded when inlined |

---

## Memory management

Memory limits are especially important in the browser:

```ts
// Set a 10MB cap
bridge.setMemoryMax(10 * 1024 * 1024);

// Check usage
console.log(`${bridge.getMemoryUsed()} bytes used`);
```

For accurate tracking, enable allocation tracing:

```ts
const bridge = await createLuaBridge({}, {
  traceAllocations: true,
});
```

---

## Performance considerations

- The WASM binary is ~300KB gzipped
- Base64 encoding adds ~33% overhead when inlined as a data URI
- The update loop uses `setTimeout` — long-running Lua blocks the UI
- Set `functionTimeout` to prevent runaway scripts:

```ts
const bridge = await createLuaBridge({}, {
  functionTimeout: 500, // max 500ms per Lua call
});
```

---

## Related

- [Getting started](../getting-started.md) — install and first bridge
- [Configuration reference](../reference/configuration.md) — all runtime options
- [Development](../development.md) — building from source
