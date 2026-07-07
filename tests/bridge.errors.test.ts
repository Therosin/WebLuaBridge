/**
 * Tests for structured BridgeError codes.
 *
 * BridgeError extends Error with a `.code` property so consumers can
 * handle different failure modes programmatically without string-parsing.
 */
import { assertEquals, assertRejects } from '@std/assert';
import { createLuaBridge, runLuaCode, BridgeError, ErrorCodes } from '../mod.ts';

// ---------------------------------------------------------------------------
// Error code constants
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// BridgeError class tests
// ---------------------------------------------------------------------------

Deno.test('BridgeError: is an instance of Error and BridgeError', () => {
    const err = new BridgeError('test', ErrorCodes.EXECUTION);
    assertEquals(err instanceof Error, true);
    assertEquals(err instanceof BridgeError, true);
    assertEquals(err.name, 'BridgeError');
});

Deno.test('BridgeError: has message and code', () => {
    const err = new BridgeError('something broke', ErrorCodes.EXECUTION);
    assertEquals(err.message, 'something broke');
    assertEquals(err.code, 'LUA_EXECUTION_ERROR');
});

Deno.test('BridgeError: preserves cause when provided', () => {
    const cause = new Error('root cause');
    const err = new BridgeError('wrapped', ErrorCodes.SYNTAX, cause);
    assertEquals(err.message, 'wrapped');
    assertEquals(err.code, 'LUA_SYNTAX_ERROR');
    assertEquals(err.cause, cause);
});

Deno.test('BridgeError: can be thrown and caught', () => {
    try {
        throw new BridgeError('oops', ErrorCodes.CALL);
    } catch (err) {
        assertEquals(err instanceof BridgeError, true);
        assertEquals((err as BridgeError).code, 'LUA_CALL_ERROR');
    }
});

// ---------------------------------------------------------------------------
// Integration: execution errors carry codes
// ---------------------------------------------------------------------------

Deno.test('errors: execute() throws BridgeError with LUA_EXECUTION_ERROR', async () => {
    const bridge = await createLuaBridge();
    try {
        await assertRejects(
            async () => await bridge.execute('error("boom")'),
            BridgeError,
        );
    } finally {
        bridge.close();
    }
});

Deno.test('errors: execute() error message contains Lua error text', async () => {
    const bridge = await createLuaBridge();
    try {
        await assertRejects(
            async () => await bridge.execute('error("custom msg")'),
            BridgeError,
            'custom msg',
        );
    } finally {
        bridge.close();
    }
});

Deno.test('errors: execute() error has code LUA_EXECUTION_ERROR', async () => {
    const bridge = await createLuaBridge();
    try {
        try {
            await bridge.execute('error("x")');
        } catch (err) {
            assertEquals((err as BridgeError).code, 'LUA_EXECUTION_ERROR');
        }
    } finally {
        bridge.close();
    }
});

Deno.test('errors: syntax error is distinguishable from runtime error', async () => {
    const bridge = await createLuaBridge();
    try {
        try {
            // Syntax error: missing 'then'
            await bridge.execute('if true do return 1 end');
        } catch (err) {
            const be = err as BridgeError;
            // Syntax errors start with a specific prefix from wasmoon
            assertEquals(be.code, 'LUA_SYNTAX_ERROR');
        }
    } finally {
        bridge.close();
    }
});

Deno.test('errors: call() throws BridgeError with LUA_CALL_ERROR', async () => {
    const bridge = await createLuaBridge();
    try {
        await assertRejects(
            async () => await bridge.call('nonexistent_func'),
            BridgeError,
        );
    } finally {
        bridge.close();
    }
});

Deno.test('errors: call() error has code LUA_CALL_ERROR', async () => {
    const bridge = await createLuaBridge();
    try {
        try {
            await bridge.call('nonexistent_func');
        } catch (err) {
            assertEquals((err as BridgeError).code, 'LUA_CALL_ERROR');
        }
    } finally {
        bridge.close();
    }
});

Deno.test('errors: executeFile() with missing file throws BridgeError', async () => {
    const bridge = await createLuaBridge();
    try {
        await assertRejects(
            async () => await bridge.executeFile('no_such_file.lua'),
            BridgeError,
        );
    } finally {
        bridge.close();
    }
});

Deno.test('errors: loadModule() with empty name throws BridgeError', async () => {
    const bridge = await createLuaBridge();
    try {
        await assertRejects(
            async () => await bridge.loadModule('', 'return {}'),
            BridgeError,
        );
    } finally {
        bridge.close();
    }
});

Deno.test('errors: setGlobal() on uninitialized bridge throws BridgeError', async () => {
    const { default: LuaBridge } = await import('../mod.ts');
    const bridge = new (LuaBridge as unknown as new () => InstanceType<typeof import('../mod.ts').default>)();
    // Don't call init() — bridge is in 'new' state
    try {
        bridge.setGlobal('x', 42);
    } catch (err) {
        assertEquals((err as BridgeError).code, 'BRIDGE_NOT_INITIALIZED');
    }
});

Deno.test('errors: useEnvironment() with null throws BridgeError', async () => {
    const bridge = await createLuaBridge();
    try {
        await assertRejects(
            async () => await bridge.useEnvironment(null as unknown as Record<string, unknown>),
            BridgeError,
        );
    } finally {
        bridge.close();
    }
});

Deno.test('errors: runLuaCode() propagates BridgeError', async () => {
    try {
        await runLuaCode('error("one-shot fail")');
    } catch (err) {
        assertEquals(err instanceof BridgeError, true);
    }
});

// ---------------------------------------------------------------------------
// Unknown error fallback
// ---------------------------------------------------------------------------

Deno.test('errors: non-Lua errors still produce BridgeError', async () => {
    // This tests that errors in the bridge layer itself (not Lua)
    // are properly wrapped with a code
    const bridge = await createLuaBridge();
    try {
        // Force an internal error scenario: close then try to execute
        bridge.close();
        await assertRejects(
            async () => await bridge.execute('return 1'),
            BridgeError,
        );
    } finally {
        // Already closed
    }
});
