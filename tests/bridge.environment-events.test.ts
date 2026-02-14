import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { createLuaBridge } from '../mod.ts';

Deno.test('bridge: useEnvironment mutates JS env and returns values', async () => {
    const bridge = await createLuaBridge();
    const env = {
        counter: 1,
        nested: { value: 10 },
        output: '',
    };

    try {
        const plugin = await bridge.useEnvironment(env);
        const result = await plugin.execute(`
            counter = counter + 41
            nested.value = nested.value + 2
            output = "done"
            return counter
        `);

        assertEquals(result, 42);
        assertEquals(env.counter, 42);
        assertEquals(env.nested.value, 12);
        assertEquals(env.output, 'done');
    } finally {
        bridge.close();
    }
});

Deno.test('bridge: event rebroadcast works between Lua and JS', async () => {
    const bridge = await createLuaBridge();
    const env = { seen: 0, last: 0 };
    try {
        const plugin = await bridge.useEnvironment(env);
        await plugin.execute(`
            Events:On("plugin:update", function(value)
                seen = seen + 1
                last = value
            end)
            Events:Emit("plugin:update", 7)
        `);

        assertEquals(env.seen, 1);
        assertEquals(env.last, 7);

        const jsEmitCount = bridge.emit('plugin:update', 11);
        assertEquals(jsEmitCount, 1);
        assertEquals(env.seen, 2);
        assertEquals(env.last, 11);
    } finally {
        bridge.close();
    }
});

Deno.test('bridge: useEnvironment rejects invalid env', async () => {
    const bridge = await createLuaBridge();
    try {
        await assertRejects(
            async () => bridge.useEnvironment(null as unknown as Record<string, unknown>),
            Error,
            'Environment must be an object',
        );
    } finally {
        bridge.close();
    }
});

Deno.test('bridge: useEnvironment keeps environment binding inside execution lock', async () => {
    const bridge = await createLuaBridge();
    const firstEnv = { id: 'first' };
    const secondEnv = { id: 'second' };

    const firstPlugin = await bridge.useEnvironment(firstEnv);
    const secondPlugin = await bridge.useEnvironment(secondEnv);

    const originalWithExecutionLock = bridge.withExecutionLock.bind(bridge);
    let releaseFirstLock: (() => void) | null = null;
    const firstLockGate = new Promise<void>((resolve) => {
        releaseFirstLock = resolve;
    });
    let invocationCount = 0;

    bridge.withExecutionLock = async (operation) => {
        invocationCount += 1;
        if (invocationCount === 1) {
            await firstLockGate;
        }
        return await originalWithExecutionLock(operation);
    };

    try {
        const firstRun = firstPlugin.execute('return id');
        const secondRun = secondPlugin.execute('return id');

        if (releaseFirstLock) {
            releaseFirstLock();
        }

        const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
        assertEquals(firstResult, 'first');
        assertEquals(secondResult, 'second');
    } finally {
        bridge.withExecutionLock = originalWithExecutionLock;
        bridge.close();
    }
});
