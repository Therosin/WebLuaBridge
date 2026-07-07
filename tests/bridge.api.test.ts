import { assertEquals, assert, assertRejects, assertThrows } from '@std/assert';
import { createLuaBridge, runLuaCode, BridgeError, LuaClass } from '../mod.ts';

Deno.test('api: call() invokes a Lua function and returns value', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`
            function add(a, b) return a + b end
        `);
        const sum = await bridge.call<number>('add', 40, 2);
        assertEquals(sum, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: call() returns multiple values as array', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`
            function stats() return 10, 20, 30 end
        `);
        const result = await bridge.call<number[]>('stats') as number[];
        assertEquals(result.length, 3);
        assertEquals(result[0], 10);
        assertEquals(result[1], 20);
        assertEquals(result[2], 30);
    } finally {
        bridge.close();
    }
});

Deno.test('api: call() throws on missing function', async () => {
    const bridge = await createLuaBridge();
    try {
        await assertRejects(
            async () => await bridge.call('nonexistent_func'),
            Error,
        );
    } finally {
        bridge.close();
    }
});

Deno.test('api: call() with no return values returns undefined', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`function noop() end`);
        const result = await bridge.call('noop');
        assertEquals(result, undefined);
    } finally {
        bridge.close();
    }
});

Deno.test('api: onPrint() captures Lua print output', async () => {
    const bridge = await createLuaBridge();
    try {
        const logs: string[] = [];
        bridge.onPrint((msg) => logs.push(msg));
        await bridge.execute('print("hello", "world")');
        assertEquals(logs.length, 1);
        assertEquals(logs[0], 'hello\tworld');
    } finally {
        bridge.close();
    }
});

Deno.test('api: onPrint(null) restores original print', async () => {
    const bridge = await createLuaBridge();
    try {
        const logs: string[] = [];
        bridge.onPrint((msg) => logs.push(msg));
        await bridge.execute('print("captured")');
        assertEquals(logs.length, 1);

        bridge.onPrint(null);
        // After restore, print goes back to default (no crash)
        await bridge.execute('print("normal again")');
        // Should still be 1 — we're not capturing anymore
        assertEquals(logs.length, 1);
    } finally {
        bridge.close();
    }
});

Deno.test('api: getDeep() reads deeply nested globals', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`
            config = { debug = true, limits = { max = 100, min = 0 } }
        `);
        const max = await bridge.getDeep<number>('config.limits.max');
        assertEquals(max, 100);

        const debug = await bridge.getDeep<boolean>('config.debug');
        assertEquals(debug, true);
    } finally {
        bridge.close();
    }
});

Deno.test('api: getDeep() returns default for missing path', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`config = {}`);
        const missing = await bridge.getDeep('config.nonexistent', 'fallback');
        assertEquals(missing, 'fallback');
    } finally {
        bridge.close();
    }
});

Deno.test('api: getDeep() returns undefined for missing path without default', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`config = {}`);
        const result = await bridge.getDeep('config.nonexistent');
        assertEquals(result, undefined);
    } finally {
        bridge.close();
    }
});

Deno.test('api: setDeep() writes deeply nested globals', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.setDeep('game.player.name', 'Hero');
        const name = await bridge.execute<string>('return game.player.name');
        assertEquals(name, 'Hero');
    } finally {
        bridge.close();
    }
});

Deno.test('api: setDeep() auto-creates intermediate tables', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.setDeep('a.b.c.d', 42);
        const val = await bridge.execute<number>('return a.b.c.d');
        assertEquals(val, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: setGlobals() sets multiple globals at once', async () => {
    const bridge = await createLuaBridge();
    try {
        bridge.setGlobals({ x: 10, y: 20, z: 30 });
        const sum = await bridge.execute<number>('return x + y + z');
        assertEquals(sum, 60);
    } finally {
        bridge.close();
    }
});

Deno.test('api: reopen() allows re-initializing a closed bridge', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('return 1');
        bridge.close();
        assertEquals(bridge.reopen(), true);
        await bridge.init();
        const result = await bridge.execute<number>('return 40 + 2');
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: reopen() returns false for non-closed bridge', async () => {
    const bridge = await createLuaBridge();
    try {
        assertEquals(bridge.reopen(), false);
    } finally {
        bridge.close();
    }
});

Deno.test('api: isStarted() and isMainLoopActive() reflect lifecycle state', async () => {
    const bridge = await createLuaBridge();
    try {
        assertEquals(bridge.isStarted(), false);
        assertEquals(bridge.isMainLoopActive(), false);

        await bridge.mountFile('init.lua', 'function OnInit() end function Update(dt) end');
        await bridge.start({ intervalMs: 100 });
        assertEquals(bridge.isStarted(), true);
        assertEquals(bridge.isMainLoopActive(), true);

        await bridge.shutdown();
        assertEquals(bridge.isStarted(), false);
        assertEquals(bridge.isMainLoopActive(), false);
    } finally {
        bridge.close();
    }
});

Deno.test('api: executeRaw runs code synchronously', async () => {
    const bridge = await createLuaBridge();
    try {
        const result = bridge.executeRaw<number>('return 40 + 2');
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: getMemoryUsed returns a number', async () => {
    const bridge = await createLuaBridge({}, { traceAllocations: true });
    try {
        const mem = bridge.getMemoryUsed();
        assertEquals(typeof mem, 'number');
        assert(mem >= 0);
    } finally {
        bridge.close();
    }
});

Deno.test('api: setMemoryMax and getMemoryMax work together', async () => {
    const bridge = await createLuaBridge({}, { traceAllocations: true });
    try {
        bridge.setMemoryMax(100 * 1024 * 1024); // 100 MB
        const max = bridge.getMemoryMax();
        assertEquals(max, 100 * 1024 * 1024);
    } finally {
        bridge.close();
    }
});

Deno.test('api: dumpStack does not throw', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('x = 42');
        bridge.dumpStack(); // smoke test — no assertion, just no throw
    } finally {
        bridge.close();
    }
});

Deno.test('api: loadCommon() makes common.lua available', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.loadCommon();
        const detourResult = await bridge.execute(`
            local common = require("common")
            return type(common.Detour)
        `);
        assertEquals(detourResult, 'function');

        const classes = await bridge.execute(`
            local common = require("common")
            return { type(common.OnlyRunOnce), type(common.ReadOnly), type(common.Class) }
        `);
        assertEquals(classes, ['function', 'function', 'function']);
    } finally {
        bridge.close();
    }
});

Deno.test('api: loadCommon(true) injects globals', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.loadCommon(true);
        const result = await bridge.execute(`
            return { type(Detour), type(OnlyRunOnce), type(ReadOnly), type(Class) }
        `);
        assertEquals(result, ['function', 'function', 'function', 'function']);
    } finally {
        bridge.close();
    }
});

Deno.test('api: createLuaBridge files option mounts before execution', async () => {
    const bridge = await createLuaBridge({}, {
        files: {
            'lib/math.lua': 'return { add = function(a,b) return a + b end }',
        },
    });
    try {
        // The function should be callable from the mounted file
        const sum = await bridge.execute(`
            local m = require("lib/math")
            return m.add(20, 22)
        `);
        assertEquals(sum, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: useEnvironment files option mounts per-environment files', async () => {
    const bridge = await createLuaBridge();
    try {
        const env = {};
        const plugin = await bridge.useEnvironment(env, {
            files: {
                'scripts/helper.lua': 'return "helper_loaded"',
            },
        });

        // The file is mounted globally, accessible from the scoped context
        const result = await plugin.execute(`
            return dofile("scripts/helper.lua")
        `);
        assertEquals(result, 'helper_loaded');
    } finally {
        bridge.close();
    }
});

Deno.test('api: error recovery — bridge works after Lua error', async () => {
    const bridge = await createLuaBridge();
    try {
        // Trigger a Lua error
        await assertRejects(
            async () => await bridge.execute('error("boom")'),
            Error,
        );

        // Bridge should still be usable
        const result = await bridge.execute<number>('return 40 + 2');
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: GetFunction returns callable handle', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('function add(a, b) return a + b end');
        const add = bridge.GetFunction<(a: number, b: number) => number>('add');
        const result = await add(40, 2);
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: GetFunction resolves name at call time', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('fn = function() return "first" end');
        const fn = bridge.GetFunction<() => string>('fn');
        const r1 = await fn();
        assertEquals(r1, 'first');

        // Mutate the Lua function
        await bridge.execute('fn = function() return "second" end');
        const r2 = await fn();
        assertEquals(r2, 'second');
    } finally {
        bridge.close();
    }
});

Deno.test('api: GetFunction returns undefined for void functions', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('function noop() end');
        const fn = bridge.GetFunction<() => undefined>('noop');
        const result = await fn();
        assertEquals(result, undefined);
    } finally {
        bridge.close();
    }
});

Deno.test('api: GetMethod calls with self binding', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`
            game = { name = "TestGame" }
            function game.getPlayer(self, id)
                return self.name .. ":player" .. id
            end
        `);
        const getPlayer = bridge.GetMethod<(id: number) => string>('game.getPlayer');
        const result = await getPlayer(42);
        assertEquals(result, 'TestGame:player42');
    } finally {
        bridge.close();
    }
});

Deno.test('api: GetMethod flat same as GetFunction', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('function greet(name) return "Hello " .. name end');
        const greet = bridge.GetMethod<(name: string) => string>('greet');
        const result = await greet('World');
        assertEquals(result, 'Hello World');
    } finally {
        bridge.close();
    }
});

Deno.test('api: GetMethod works with colon-defined method syntax', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`
            game = { name = "Test" }
            function game:getInfo(id)
                return self.name .. ":" .. id
            end
        `);
        const getInfo = bridge.GetMethod<(id: number) => Promise<string>>('game.getInfo');
        const result = await getInfo(42);
        assertEquals(result, 'Test:42');
    } finally {
        bridge.close();
    }
});

Deno.test('api: GetMethod throws on invalid paths', async () => {
    const bridge = await createLuaBridge();
    try {
        assertThrows(() => bridge.GetMethod('game.getPlayer; os.execute("rm")'), BridgeError);
        assertThrows(() => bridge.GetMethod('a[b].c'), BridgeError);
        assertThrows(() => bridge.GetMethod(''), BridgeError);
        assertThrows(() => bridge.GetMethod('a..b'), BridgeError);
    } finally {
        bridge.close();
    }
});

Deno.test('api: GetMethod works with deeply nested path', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute(`
            a = { b = { c = { method = function(self, x) return x + 1 end } } }
        `);
        const fn = bridge.GetMethod<(x: number) => Promise<number>>('a.b.c.method');
        const result = await fn(41);
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: SetFunction sets JS function as Lua global', async () => {
    const bridge = await createLuaBridge();
    try {
        bridge.SetFunction('jsFunc', ((a: number, b: number) => a + b) as unknown as (...args: unknown[]) => unknown);
        const result = await bridge.execute<number>('return jsFunc(40, 2)');
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: SetMethod sets JS function as method', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('math = {}');
        bridge.SetMethod('math.add', ((a: number, b: number) => a + b) as unknown as (...args: unknown[]) => unknown);
        const result = await bridge.execute<number>('return math.add(40, 2)');
        assertEquals(result, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: SetFunction returns Promise and awaits Set', async () => {
    const bridge = await createLuaBridge();
    try {
        const fn = (x: number) => x * 2;
        const result = bridge.SetFunction('setFnTest', fn);
        assert(result instanceof Promise);
        await result;
        const val = await bridge.call<number>('setFnTest', 21);
        assertEquals(val, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: SetMethod returns Promise and awaits Set', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('math = {}');
        const fn = (x: number) => x + 1;
        const result = bridge.SetMethod('math.inc', fn);
        assert(result instanceof Promise);
        await result;
        const val = await bridge.execute<number>('return math.inc(41)');
        assertEquals(val, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: runLuaCode one-shot with args', async () => {
    const result = await runLuaCode<number>('return ... + 1', 41);
    assertEquals(result, 42);
});

Deno.test('api: Get flat global', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('x = 42');
        const x = await bridge.Get<number>('x');
        assertEquals(x, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: Get dotted path', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('config = { limits = { max = 100 } }');
        const max = await bridge.Get<number>('config.limits.max');
        assertEquals(max, 100);
    } finally {
        bridge.close();
    }
});

Deno.test('api: Get returns default for missing path', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('config = {}');
        const missing = await bridge.Get('config.nonexistent', 'fallback');
        assertEquals(missing, 'fallback');
    } finally {
        bridge.close();
    }
});

Deno.test('api: Get returns undefined for missing path without default', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.execute('config = {}');
        const result = await bridge.Get('config.nonexistent');
        assertEquals(result, undefined);
    } finally {
        bridge.close();
    }
});

Deno.test('api: Get flat missing returns undefined', async () => {
    const bridge = await createLuaBridge();
    try {
        const result = await bridge.Get('nonexistent_key');
        assertEquals(result, undefined);
    } finally {
        bridge.close();
    }
});

Deno.test('api: Set flat global', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.Set('x', 42);
        const x = await bridge.execute<number>('return x');
        assertEquals(x, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: Set dotted path with auto-created tables', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.Set('a.b.c.d', 42);
        const val = await bridge.execute<number>('return a.b.c.d');
        assertEquals(val, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('api: Set and Get round-trip dotted', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.Set('profile.name', 'Hero');
        const name = await bridge.Get<string>('profile.name');
        assertEquals(name, 'Hero');
    } finally {
        bridge.close();
    }
});

Deno.test('api: Set throws on LuaClass with dotted path', async () => {
    const bridge = await createLuaBridge();
    try {
        const cls = new LuaClass({ name: 'Test' }).method('foo', () => 'bar');
        await assertRejects(
            () => bridge.Set('nested.path.Test', cls),
            BridgeError,
        );
    } finally {
        bridge.close();
    }
});

Deno.test('api: Set with dotted path survives reopen', async () => {
    const bridge = await createLuaBridge();
    try {
        await bridge.Set('config.deep.value', 42);
        assertEquals(await bridge.Get('config.deep.value'), 42);

        bridge.close();
        bridge.reopen();
        await bridge.init();

        const val = await bridge.Get('config.deep.value');
        assertEquals(val, 42);
    } finally {
        bridge.close();
    }
});
