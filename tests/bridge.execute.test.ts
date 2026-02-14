import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { createLuaBridge, runLuaCode } from '../mod.ts';

Deno.test('bridge: execute, mountFile/executeFile, and loadModule', async () => {
    const bridge = await createLuaBridge({ appName: 'DenoE2E' });
    try {
        const sum = await bridge.execute('return 40 + 2');
        assertEquals(sum, 42);

        await bridge.mountFile('hello.lua', 'return appName');
        const fileResult = await bridge.executeFile('hello.lua');
        assertEquals(fileResult, 'DenoE2E');

        await bridge.loadModule('mod_math', 'return { value = 99 }');
        const moduleValue = await bridge.execute('return require("mod_math").value');
        assertEquals(moduleValue, 99);
    } finally {
        bridge.close();
    }
});

Deno.test('bridge: validates loadModule input and not-initialized access', async () => {
    const bridge = await createLuaBridge();
    await assertRejects(
        async () => bridge.loadModule('', 'return {}'),
        Error,
        'Module name must be a non-empty string',
    );
    bridge.close();

    const notInit = new (await import('../src/lua_bridge.ts')).default();
    await assertRejects(
        async () => notInit.execute('return 1'),
        Error,
        'LuaBridge not initialized',
    );
});

Deno.test('bridge: runLuaCode one-shot helper works', async () => {
    const result = await runLuaCode('return 7 * 6');
    assertEquals(result, 42);
});
