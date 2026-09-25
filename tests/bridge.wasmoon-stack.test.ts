import { assertEquals, assertThrows } from "@std/assert";
import { createLuaBridge } from "../mod.ts";
import type { LuaEngine } from "../src/lua/types.ts";

Deno.test("bridge restores Wasmoon stack after result-producing calls", async () => {
    const bridge = await createLuaBridge();
    try {
        // Inspect the wrapped engine directly: the bridge intentionally keeps
        // the raw runtime private in its public API.
        const lua = Reflect.get(bridge, "lua") as LuaEngine;
        assertEquals(lua.global.getTop(), 0);

        for (let i = 0; i < 100; i++) {
            assertEquals(await bridge.execute<number>("return 42"), 42);
        }
        assertEquals(lua.global.getTop(), 0);

        assertEquals(await bridge.execute("return 1, 2, 3"), [1, 2, 3]);
        assertEquals(lua.global.getTop(), 0);

        const table = await bridge.execute<{ value: number }>(
            "return { value = 42 }",
        );
        assertEquals(table.value, 42);
        const returnedFunction = await bridge.execute<() => number>(
            "return function() return 42 end",
        );
        assertEquals(returnedFunction(), 42);
        assertEquals(lua.global.getTop(), 0);

        await bridge.execute("function stack_guard_add(a, b) return a + b end");
        for (let i = 0; i < 100; i++) {
            assertEquals(
                await bridge.call<number>("stack_guard_add", 20, 22),
                42,
            );
        }
        assertEquals(lua.global.getTop(), 0);

        for (let i = 0; i < 100; i++) {
            assertEquals(lua.doStringSync<number>("return 42"), 42);
        }
        assertEquals(lua.global.getTop(), 0);

        assertThrows(
            () => lua.doStringSync('error("expected failure")'),
            Error,
        );
        assertEquals(lua.global.getTop(), 0);
        assertEquals(await bridge.execute<number>("return 40 + 2"), 42);
        assertEquals(lua.global.getTop(), 0);
    } finally {
        bridge.close();
    }
});
