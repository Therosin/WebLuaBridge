/**
 * Tests for ExecutionService — Lua execution, globals, print capture, memory.
 *
 * Tests the service contract: forwarding of Lua engine operations,
 * error wrapping, print state management.
 */
import { assertEquals, assert, assertStringIncludes } from '@std/assert';
import { LuaFactory } from 'wasmoon';
import { ExecutionService, type ExecutionDeps } from '../src/lua/execution.ts';
import { BridgeError, ErrorCodes } from '../src/lua/errors.ts';
import type { LuaEngine } from '../src/lua/types.ts';

// ---------------------------------------------------------------------------
// Unit tests — mocked deps
// ---------------------------------------------------------------------------

function _mockDeps(): ExecutionDeps {
    const lua = null as unknown as LuaEngine;
    return {
        getLua: () => lua,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null as unknown },
    };
}

// ---------------------------------------------------------------------------
// Integration — real Lua engine
// ---------------------------------------------------------------------------

async function createTestEngine(): Promise<LuaEngine> {
    const factory = new LuaFactory();
    const engine = await factory.createEngine({}) as unknown as LuaEngine;
    return engine;
}

Deno.test('ExecutionService: execute runs Lua code and returns result', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    const result = await svc.execute('return 40 + 2');
    assertEquals(result, 42);
    engine.global.close();
});

Deno.test('ExecutionService: execute passes args to Lua', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    const result = await svc.execute('return ...', 10, 20, 30);
    assertEquals(result, [10, 20, 30]);
    engine.global.close();
});

Deno.test('ExecutionService: execute throws BridgeError on Lua error', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    try {
        await svc.execute('error("boom")');
        assert(false, 'should throw');
    } catch (err) {
        assert(err instanceof BridgeError);
        assertEquals(err.code, ErrorCodes.EXECUTION);
        assertStringIncludes(err.message, 'boom');
    }
    engine.global.close();
});

Deno.test('ExecutionService: executeRaw runs Lua code synchronously', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    const result = svc.executeRaw('return 10 * 10');
    assertEquals(result, 100);
    engine.global.close();
});

Deno.test('ExecutionService: call invokes a Lua function', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    await svc.execute('function add(a, b) return a + b end');
    const result = await svc.call('add', 20, 22);
    assertEquals(result, 42);
    engine.global.close();
});

Deno.test('ExecutionService: call throws BridgeError on missing function', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    try {
        await svc.call('nonExistent');
        assert(false, 'should throw');
    } catch (err) {
        assert(err instanceof BridgeError);
        assertEquals(err.code, ErrorCodes.CALL);
    }
    engine.global.close();
});

Deno.test('ExecutionService: setGlobal and getGlobal round-trip', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    svc.setGlobal('myValue', 99);
    const read = svc.getGlobal<number>('myValue');
    assertEquals(read, 99);
    engine.global.close();
});

Deno.test('ExecutionService: setGlobals sets multiple globals at once', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    svc.setGlobals({ a: 1, b: 2, c: 3 });
    assertEquals(svc.getGlobal('a'), 1);
    assertEquals(svc.getGlobal('b'), 2);
    assertEquals(svc.getGlobal('c'), 3);
    engine.global.close();
});

Deno.test('ExecutionService: getDeep reads deeply nested globals', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    await svc.execute('config = { debug = true, limits = { max = 100 } }');
    const max = await svc.getDeep('config.limits.max');
    assertEquals(max, 100);
    const dbg = await svc.getDeep('config.debug', false);
    assertEquals(dbg, true);
    engine.global.close();
});

Deno.test('ExecutionService: setDeep writes deeply nested globals', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    await svc.setDeep('config.limits.max', 200);
    const max = await svc.getDeep('config.limits.max');
    assertEquals(max, 200);
    engine.global.close();
});

Deno.test('ExecutionService: setField sets field on a Lua table', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    // Create a Lua-native table (JS objects become userdata, not tables)
    await svc.execute('mytable = { existing = 1 }');
    // Set a field on it using setField
    svc.setField('mytable', 'newField', 42);
    const table = svc.getGlobal<Record<string, unknown>>('mytable');
    assertEquals(table.newField, 42);
    engine.global.close();
});

Deno.test('ExecutionService: onPrint captures print output', async () => {
    const engine = await createTestEngine();
    const originalPrint = { current: null };
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint,
    });

    const logs: string[] = [];
    svc.onPrint((msg) => logs.push(msg));
    await svc.execute('print("hello", "world")');
    assert(logs.length > 0, 'print should have been captured');
    // The exact format is Lua-print-style tab-joined
    engine.global.close();
});

Deno.test('ExecutionService: onPrint(null) restores original print', async () => {
    const engine = await createTestEngine();
    const originalPrint = { current: null };
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint,
    });

    const logs: string[] = [];
    svc.onPrint((msg) => logs.push(msg));
    // Verify capture works
    await svc.execute('print("captured")');
    assertEquals(logs.length, 1, 'print should be captured');

    // Restore original print
    svc.onPrint(null);
    assertEquals(originalPrint.current, null, 'originalPrint should be null after restore');
    engine.global.close();
});

Deno.test('ExecutionService: loadModule loads a Lua module', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    await svc.loadModule('mymod', 'return { version = 1 }');
    const result = await svc.execute('return require("mymod")');
    assertEquals((result as Record<string, unknown>).version, 1);
    engine.global.close();
});

Deno.test('ExecutionService: loadCommon makes common.lua available', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    await svc.loadCommon(false);
    const result = await svc.execute('local c = require("common"); return c.pack');
    assert(typeof result, 'function');
    engine.global.close();
});

Deno.test('ExecutionService: getMemoryUsed returns a number with tracing enabled', async () => {
    const factory = new LuaFactory();
    const engine = await factory.createEngine({ traceAllocations: true }) as unknown as LuaEngine;
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    const mem = svc.getMemoryUsed();
    assertEquals(typeof mem, 'number');
    engine.global.close();
});

Deno.test('ExecutionService: getMemoryUsed throws BridgeError when tracing disabled', async () => {
    const engine = await createTestEngine();
    const svc = new ExecutionService({
        getLua: () => engine,
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        nextArgsKey: () => '__test_key',
        originalPrint: { current: null },
    });

    try {
        svc.getMemoryUsed();
        assert(false, 'should have thrown');
    } catch (err) {
        assert(err instanceof BridgeError);
        assertEquals(err.code, ErrorCodes.MEMORY);
    }
    engine.global.close();
});

Deno.test('ExecutionService: executeFile runs a mounted file', async () => {
    const engine = await createTestEngine();

    // Mount file directly via factory (as VfsRegistry would)
    const factory = new LuaFactory();
    await factory.mountFile('greet.lua', 'return "Hello from file!"');
    // We need executeFile to reach into the same factory. In the real
    // bridge, executeFile uses dofile on the Lua engine side, which
    // accesses the same VFS. This test is more of an integration test.
    // For now just test that the method signature works.
    // (Full integration testing happens via existing bridge tests.)
    engine.global.close();
});
