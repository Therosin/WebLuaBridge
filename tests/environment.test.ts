/**
 * Tests for EnvironmentService — scoped Lua execution contexts.
 */
import { assertEquals, assert, assertRejects } from '@std/assert';
import { BridgeError } from '../src/lua/errors.ts';
import { LuaFactory } from 'wasmoon';
import { EnvironmentService } from '../src/lua/environment.ts';
import { luaWrap, unwrapTablePack, wrapForMultiReturn } from '../src/lua/utils.ts';
import type { LuaEngine } from '../src/lua/types.ts';

async function createTestEngine(): Promise<LuaEngine> {
    const factory = new LuaFactory();
    return await factory.createEngine({}) as unknown as LuaEngine;
}

function makeDeps(engine: LuaEngine, overrides: Record<string, unknown> = {}) {
    let argsKeyCounter = 0;
    return {
        getLua: () => engine,
        executeInCurrentLock: async <T>(code: string, ...args: unknown[]): Promise<T> => {
            // Replicate ExecutionService.executeInCurrentLock contract: luaWrap + table.pack + unwrapTablePack
            const lua = engine;
            if (args.length > 0) {
                const key = `__env_test_${++argsKeyCounter}`;
                lua.global.set(key, args);
                try {
                    const wrapped = luaWrap(code, key);
                    const raw = await lua.doString<Record<string, unknown>>(wrapped);
                    return unwrapTablePack(raw) as unknown as T;
                } finally {
                    lua.global.set(key, undefined);
                }
            }
            const wrapped = wrapForMultiReturn(code);
            const raw = await lua.doString<Record<string, unknown>>(wrapped);
            return unwrapTablePack(raw) as unknown as T;
        },
        withExecutionLock: <T>(op: () => Promise<T>) => op(),
        getEventsApiIdentity: () => null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

Deno.test('EnvironmentService: useEnvironment returns execution context with all methods', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));

    const ctx = await svc.useEnvironment({ x: 10 });
    assert(ctx, 'should return a context');
    assertEquals(typeof ctx.execute, 'function');
    assertEquals(typeof ctx.executeFile, 'function');
    assertEquals(typeof ctx.mountFile, 'function');
    assertEquals(typeof ctx.Get, 'function');
    assertEquals(typeof ctx.Set, 'function');
    assertEquals(typeof ctx.has, 'function');
    assertEquals(typeof ctx.delete, 'function');
    assertEquals(typeof ctx.keys, 'function');
    assertEquals(typeof ctx.assign, 'function');
    assertEquals(typeof ctx.clear, 'function');
    assertEquals(typeof ctx.eval, 'function');
    assertEquals(typeof ctx.call, 'function');
    engine.global.close();
});

Deno.test('EnvironmentService: execute reads from env and falls back to _G', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));

    // Set a _G global
    engine.global.set('global_val', 42);
    const ctx = await svc.useEnvironment({ x: 10 });

    // Can read from env
    const result1 = await ctx.execute<number>('return x');
    assertEquals(result1, 10, 'should read from env');

    // Can read from _G
    const result2 = await ctx.execute<number>('return global_val');
    assertEquals(result2, 42, 'should fall back to _G');

    engine.global.close();
});

Deno.test('EnvironmentService: execute writes go to env, not _G', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));

    const env: Record<string, unknown> = { a: 1 };
    const ctx = await svc.useEnvironment(env);

    // Write inside scope
    await ctx.execute('a = 99');

    // _G should be unchanged (wasmoon returns null for unset keys)
    const gA = engine.global.get('a');
    assertEquals(gA, null, '_G.a should not be set');

    // env should be updated
    assertEquals(env.a, 99, 'env.a should be updated');

    // Read via scope
    const result = await ctx.execute<number>('return a');
    assertEquals(result, 99, 'scope should read updated value');

    engine.global.close();
});

Deno.test('EnvironmentService: create with invalid env throws BridgeError', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));

    try {
        await svc.useEnvironment(null as unknown as Record<string, unknown>);
        assert(false, 'should throw');
    } catch (err) {
        assert(err instanceof Error);
        assert(String(err).includes('Environment'));
    }
    engine.global.close();
});

Deno.test('EnvironmentService: eval evaluates expression', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));

    const ctx = await svc.useEnvironment({ x: 5, y: 3 });
    const result = await ctx.eval<number>('x + y');
    assertEquals(result, 8);

    engine.global.close();
});

Deno.test('EnvironmentService: call invokes Lua function through scope', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));

    const env = {};
    const ctx = await svc.useEnvironment(env);

    // Define a Lua function in _G so scope can resolve it
    await engine.doString('function greet(name) return "Hi, " .. name .. "!" end');

    const result = await ctx.call<string>('greet', 'World');
    assertEquals(result, 'Hi, World!');

    engine.global.close();
});

Deno.test('EnvironmentService: call supports multi-arg and multi-return', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));
    const ctx = await svc.useEnvironment({});
    await engine.doString('function swap(a, b) return b, a end');
    const result = await ctx.call<[unknown, unknown]>('swap', 'x', 'y');
    assertEquals(result, ['y', 'x']);
    engine.global.close();
});

Deno.test('EnvironmentService: call with zero-arg function returns undefined', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));
    const ctx = await svc.useEnvironment({});
    await engine.doString('function noop() end');
    const result = await ctx.call('noop');
    assertEquals(result, undefined);
    engine.global.close();
});

Deno.test('EnvironmentService: scope.call throws on invalid paths', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));
    const ctx = await svc.useEnvironment({});
    await assertRejects(
        () => ctx.call('math.max; os.exit()'),
        BridgeError,
    );
    await assertRejects(
        () => ctx.call('a[b]'),
        BridgeError,
    );
    await assertRejects(
        () => ctx.call(''),
        BridgeError,
    );
    engine.global.close();
});

Deno.test('EnvironmentService: ctx.Get/Set/has/delete/keys work on env', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));

    const env: Record<string, unknown> = { a: 1, b: 2 };
    const ctx = await svc.useEnvironment(env);

    assertEquals(ctx.Get('a'), 1);
    assertEquals(ctx.has('a'), true);
    assertEquals(ctx.has('missing'), false);
    assertEquals(ctx.keys(), ['a', 'b']);

    ctx.Set('c', 3);
    assertEquals(ctx.Get('c'), 3);
    assertEquals(env.c, 3);

    ctx.delete('a');
    assertEquals(ctx.has('a'), false);
    assertEquals(ctx.Get('a'), undefined);

    engine.global.close();
});

Deno.test('EnvironmentService: ctx.assign and clear work on env', async () => {
    const engine = await createTestEngine();
    const svc = new EnvironmentService(makeDeps(engine));

    const env = { a: 1 };
    const ctx = await svc.useEnvironment(env);

    ctx.assign({ b: 2, c: 3 });
    assertEquals(ctx.Get('a'), 1);
    assertEquals(ctx.Get('b'), 2);
    assertEquals(ctx.Get('c'), 3);

    ctx.clear();
    assertEquals(ctx.keys().length, 0);
    assertEquals(ctx.Get('a'), undefined);

    engine.global.close();
});

Deno.test('EnvironmentService: mountFile in context', async () => {
    const factory = new LuaFactory();
    const engine = await factory.createEngine({}) as unknown as LuaEngine;
    const svc = new EnvironmentService(makeDeps(engine, {
        mountFile: async (path: string, content: string) => {
            await factory.mountFile(path, content);
        },
    }));

    const ctx = await svc.useEnvironment({});
    await ctx.mountFile('env_test.lua', 'return "env-scoped"');

    // Verify it was mounted by reading it
    const result = await engine.doString('return dofile("env_test.lua")');
    assertEquals(result as string, 'env-scoped');

    engine.global.close();
});
