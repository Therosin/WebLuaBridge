/**
 * Tests for resource cleanup on bridge close/shutdown.
 *
 * Verifies that timers, the main loop, and other resources are
 * properly cleaned up when the bridge is closed.
 */
import { assertEquals, assert } from '@std/assert';
import { createLuaBridge, BridgeError } from '../mod.ts';
import { TimerBindings } from '../src/bindings/timers.ts';
import type { BindingContext } from '../src/lua/types.ts';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Main loop cleanup
// ---------------------------------------------------------------------------

Deno.test('cleanup: main loop stops when close() is called', async () => {
    const bridge = await createLuaBridge();
    await bridge.mountFile('init.lua', `
        function OnInit() end
        function Update(dt) end
    `);
    await bridge.start({ intervalMs: 10 });
    assert(bridge.isMainLoopActive(), 'loop should be active');

    bridge.close();
    assert(!bridge.isMainLoopActive(), 'loop should be stopped after close');
});

Deno.test('cleanup: close() is idempotent — no throw on double close', async () => {
    const bridge = await createLuaBridge();
    bridge.close(); // first close
    bridge.close(); // second close — should not throw
});

// ---------------------------------------------------------------------------
// Timer binding cleanup
// ---------------------------------------------------------------------------

Deno.test('cleanup: timer bindings are cancelled when bridge is closed', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new TimerBindings(ctx)],
    });
    try {
        const marker = { fired: false };
        bridge.setGlobal('marker', marker);

        // set a timeout that would fire after bridge is closed
        await bridge.execute(`
            timers.setTimeout(function()
                marker.fired = true
            end, 50)
        `);

        // Close the bridge immediately — timer should be cancelled
        bridge.close();

        // Wait long enough for the timer to have fired if it were active
        await wait(150);

        // The timer should NOT have fired — the bridge is closed and
        // pending timers were cleared
        assertEquals(marker.fired, false, 'timeout callback should not fire after close');
    } finally {
        bridge.close();
    }
});

Deno.test('cleanup: interval bindings are cancelled when bridge is closed', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new TimerBindings(ctx)],
    });
    try {
        const state = { ticks: 0 };
        bridge.setGlobal('state', state);

        // Set an interval that would tick
        await bridge.execute(`
            timers.setInterval(function()
                state.ticks = state.ticks + 1
            end, 20)
        `);

        // Close immediately
        bridge.close();
        await wait(100);

        // The interval callback tries to mutate state — if it fired,
        // state.ticks would be > 0. But since bridge is closed and
        // timers are cancelled, it should be 0.
        // Note: this test is inherently racy — the interval might fire
        // once before clearAll() runs. We assert it's low.
        assert(state.ticks <= 1, 'interval should fire at most once (race on close)');
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// Event listener cleanup
// ---------------------------------------------------------------------------

Deno.test('cleanup: event listeners survive close/reopen cycle', async () => {
    const bridge = await createLuaBridge();
    try {
        const events: string[] = [];
        bridge.on('test:event', (msg: string) => events.push(msg));

        bridge.emit('test:event', 'before-close');
        assertEquals(events.length, 1);

        bridge.close();
        // After close, emit should still work (bus is separate from runtime)
        bridge.emit('test:event', 'after-close');
        assertEquals(events.length, 2);

        // Reset and init — listeners should persist
        bridge.reopen();
        await bridge.init();
        bridge.emit('test:event', 'after-reset');

        // The listener survived the close/reset/init cycle
        assertEquals(events.length, 3);
        assertEquals(events, ['before-close', 'after-close', 'after-reset']);
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// No dangling execution after close
// ---------------------------------------------------------------------------

Deno.test('cleanup: execute() throws after close()', async () => {
    const bridge = await createLuaBridge();
    bridge.close();

    try {
        await bridge.execute('return 1');
        assert(false, 'should have thrown');
    } catch (err) {
        assert(err instanceof BridgeError);
    }
});
