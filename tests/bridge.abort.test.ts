/**
 * Tests for AbortSignal integration with bridge execution.
 */
import { assertEquals, assertRejects } from '@std/assert';
import { createLuaBridge, BridgeError, ErrorCodes } from '../mod.ts';

Deno.test('abort: withExecutionLock rejects CANCELLED when signal already aborted', async () => {
    const bridge = await createLuaBridge();
    try {
        const ac = new AbortController();
        ac.abort();

        await assertRejects(
            () => bridge.withExecutionLock(() => Promise.resolve(42), ac.signal),
            BridgeError,
            'cancelled',
        );
    } finally {
        bridge.close();
    }
});

Deno.test('abort: execute normal result without signal', async () => {
    const bridge = await createLuaBridge();
    try {
        const result = await bridge.execute<number>('return 42');
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('abort: execute with varargs still works', async () => {
    const bridge = await createLuaBridge();
    try {
        const result = await bridge.execute<string>(
            'return ("hello " .. ...)',
            'world',
        );
        assertEquals(result, 'hello world');
    } finally {
        bridge.close();
    }
});

Deno.test('abort: execute without signal still works (backward compat)', async () => {
    const bridge = await createLuaBridge();
    try {
        const result = await bridge.execute<number>('return 1 + 2');
        assertEquals(result, 3);
    } finally {
        bridge.close();
    }
});

Deno.test('abort: withExecutionLock without signal works', async () => {
    const bridge = await createLuaBridge();
    try {
        const result = await bridge.withExecutionLock(() => Promise.resolve(42));
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('abort: call normal result without signal', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('function greet(n) return "Hi " .. n end');
        const result = await bridge.call<string>('greet', 'Test');
        assertEquals(result, 'Hi Test');
    } finally {
        bridge.close();
    }
});

Deno.test('abort: CANCELLED error code is exported', () => {
    assertEquals(ErrorCodes.CANCELLED, 'OPERATION_CANCELLED');
});

// Note: queue-wait cancellation (signal fires while operation is queued
// behind a running operation) is not tested here due to wasmoon's
// threading model making timing-dependent tests unreliable.
// The "already aborted" tests above validate the core mechanism.
