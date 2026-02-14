# WebLuaBridge Examples

These are focused usage examples for the current bridge API.

## Files
- `examples/basic-run.ts`: create bridge, execute Lua, mount and run file.
- `examples/environment-plugin.ts`: plugin-style env scoping with persistent state.
- `examples/events-bridge.ts`: JS and Lua event rebroadcast via `Events:On/Emit`.
- `examples/lifecycle-mainloop.ts`: `start()` / `shutdown()` lifecycle with JS-driven update loop.
- `examples/lifecycle/init.lua`: lifecycle script used by `lifecycle-mainloop.ts`.

## Notes
- Examples import from `../mod.ts` (public entrypoint).
- Examples are written for Deno.
