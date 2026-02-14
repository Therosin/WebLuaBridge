import { assert, assertEquals } from 'jsr:@std/assert';
import { createLuaBridge } from '../mod.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.test('bridge: start/shutdown executes OnInit/Update/OnShutdown', async () => {
    const bridge = await createLuaBridge();
    const state = { init: false, shutdown: false, ticks: 0, lastDt: 0 };

    try {
        bridge.setGlobal('state', state);
        await bridge.mountFile(
            'init.lua',
            `
            function OnInit()
                state.init = true
            end

            function Update(dt)
                state.ticks = state.ticks + 1
                state.lastDt = dt
            end

            function OnShutdown()
                state.shutdown = true
            end
            `,
        );

        await bridge.start({ intervalMs: 10 });
        await wait(50);
        await bridge.shutdown();

        assertEquals(state.init, true);
        assertEquals(state.shutdown, true);
        assert(state.ticks > 0);
        assert(state.lastDt > 0);
    } finally {
        bridge.close();
    }
});

Deno.test('bridge: start is idempotent', async () => {
    const bridge = await createLuaBridge();
    const state = { onInitCalls: 0 };

    try {
        bridge.setGlobal('state', state);
        await bridge.mountFile(
            'init.lua',
            `
            function OnInit()
                state.onInitCalls = state.onInitCalls + 1
            end
            `,
        );

        await bridge.start({ intervalMs: 10 });
        await bridge.start({ intervalMs: 10 });
        await bridge.shutdown();

        assertEquals(state.onInitCalls, 1);
    } finally {
        bridge.close();
    }
});
