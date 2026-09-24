/**
 * Copyright (C) 2026 Theros <https://github.com/therosin>
 *
 * This file is part of WebLuaBridge.
 *
 * WebLuaBridge is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * WebLuaBridge is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with WebLuaBridge.  If not, see <https://www.gnu.org/licenses/>.
 */

import { assertEquals, assert, assertRejects } from '@std/assert';
import {
    createLuaBridge,
    globalBindings,
    jsonBindings,
    LuaBinder,
    LuaBinding,
    LuaBindings,
    LuaClass,
    regexBindings,
    timersBindings,
} from '../mod.ts';
import type { BindingContext, LuaEngineLike } from '../src/lua/types.ts';

// ---------------------------------------------------------------------------
// LuaClass — standalone usage
// ---------------------------------------------------------------------------

Deno.test('LuaClass: setGlobal installs a table with methods', async () => {
    const bridge = await createLuaBridge();
    try {
        const cls = new LuaClass({ name: 'MyLib' })
            .method('greet', (name: string) => `Hello ${name}`)
            .method('add', (a: number, b: number) => a + b);

        bridge.setGlobal('MyLib', cls);

        const greet = await bridge.execute('return MyLib.greet("World")');
        assertEquals(greet, 'Hello World');

        const sum = await bridge.execute('return MyLib.add(20, 22)');
        assertEquals(sum, 42);
    } finally {
        bridge.close();
    }
});

Deno.test('LuaClass: readonly prevents table mutation', async () => {
    const bridge = await createLuaBridge();
    try {
        const cls = new LuaClass({ name: 'Config' })
            .value('debug', true)
            .readonly();

        bridge.setGlobal('Config', cls);

        const debug = await bridge.execute('return Config.debug');
        assertEquals(debug, true);

        // Attempting to modify should error
        try {
            await bridge.execute('Config.debug = false');
            assert(false, 'Should have thrown');
        } catch {
            // expected
        }
    } finally {
        bridge.close();
    }
});

Deno.test('LuaClass: values are accessible', async () => {
    const bridge = await createLuaBridge();
    try {
        const cls = new LuaClass({ name: 'Const' })
            .value('PI', 3.14)
            .value('NAME', 'test');

        bridge.setGlobal('Const', cls);

        const pi = await bridge.execute('return Const.PI');
        assertEquals(pi, 3.14);

        const name = await bridge.execute('return Const.NAME');
        assertEquals(name, 'test');
    } finally {
        bridge.close();
    }
});

Deno.test('LuaClass: setGlobal auto-installs LuaClass', async () => {
    const bridge = await createLuaBridge();
    try {
        const cls = new LuaClass({ name: 'AutoLib' })
            .method('ping', () => 'pong');

        bridge.setGlobal('AutoLib', cls);

        const result = await bridge.execute('return AutoLib.ping()');
        assertEquals(result, 'pong');
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// LuaBindings — decorator-based binding system
// ---------------------------------------------------------------------------

@LuaBinder({ namespace: 'utils' })
class UtilsBindings extends LuaBindings {
    @LuaBinding({ name: 'hello' })
    static hello(name: string): string {
        return `Hi ${name}!`;
    }

    @LuaBinding({ name: 'double' })
    static double(n: number): number {
        return n * 2;
    }
}

Deno.test('bindings: factory installs decorated methods under namespace', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new UtilsBindings(ctx)],
    });
    try {
        const hello = await bridge.execute('return utils.hello("Test")');
        assertEquals(hello, 'Hi Test!');

        const dbl = await bridge.execute('return utils.double(21)');
        assertEquals(dbl, 42);
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// Global scope bindings (no namespace)
// ---------------------------------------------------------------------------

@LuaBinder({})
class GlobalUtils extends LuaBindings {
    @LuaBinding({ name: 'js_is_array' })
    static jsIsArray(value: unknown): boolean {
        return Array.isArray(value);
    }
}

Deno.test('bindings: namespace-less bindings go to _G directly', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new GlobalUtils(ctx)],
    });
    try {
        const result1 = await bridge.execute('return js_is_array({})');
        assertEquals(result1, false);

        const result2 = await bridge.execute('return js_is_array({1,2,3})');
        assertEquals(result2, true);
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// Multiple binding factories
// ---------------------------------------------------------------------------

@LuaBinder({ namespace: 'math' })
class MathBindings extends LuaBindings {
    @LuaBinding({ name: 'square' })
    static square(n: number): number {
        return n * n;
    }
}

@LuaBinder({ namespace: 'str' })
class StringBindings extends LuaBindings {
    @LuaBinding({ name: 'upper' })
    static upper(s: string): string {
        return s.toUpperCase();
    }
}

Deno.test('bindings: multiple factories install separate namespaces', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [
            (ctx: BindingContext) => new MathBindings(ctx),
            (ctx: BindingContext) => new StringBindings(ctx),
        ],
    });
    try {
        const sq = await bridge.execute('return math.square(7)');
        assertEquals(sq, 49);

        const up = await bridge.execute('return str.upper("hello")');
        assertEquals(up, 'HELLO');
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// ctx is passed through
// ---------------------------------------------------------------------------

@LuaBinder({ namespace: 'context' })
class ContextBindings extends LuaBindings {
    @LuaBinding({ name: 'get_ctx_type' })
    static getCtxType(): string {
        const ctx = (this as unknown as ContextBindings).ctx;
        return ctx ? 'has-ctx' : 'no-ctx';
    }
}

Deno.test('bindings: ctx is available via this.ctx', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new ContextBindings(ctx)],
    });
    try {
        const result = await bridge.execute('return context.get_ctx_type()');
        assertEquals(result, 'has-ctx');
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// Readonly binding namespace
// ---------------------------------------------------------------------------

@LuaBinder({ namespace: 'ro', readonly: true })
class ReadonlyBindings extends LuaBindings {
    @LuaBinding({ name: 'get_val' })
    static getVal(): number {
        return 42;
    }
}

Deno.test('bindings: readonly namespace rejects writes', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new ReadonlyBindings(ctx)],
    });
    try {
        const val = await bridge.execute('return ro.get_val()');
        assertEquals(val, 42);

        // Writes should fail
        try {
            await bridge.execute('ro.new_key = "test"');
            assert(false, 'Should have thrown');
        } catch {
            // expected
        }
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// Regex bindings
// ---------------------------------------------------------------------------

@LuaBinder({ namespace: 'regex', readonly: true })
class RegexTestBindings extends LuaBindings {
    @LuaBinding({ name: 'match' })
    static match(str: string, pattern: string): string[] | null {
        const re = new RegExp(pattern);
        const result = re.exec(str);
        if (!result) return null;
        return Array.from(result);
    }

    @LuaBinding({ name: 'test' })
    static test(str: string, pattern: string): boolean {
        return new RegExp(pattern).test(str);
    }

    @LuaBinding({ name: 'replace' })
    static replace(str: string, pattern: string, replacement: string): string {
        return str.replace(new RegExp(pattern), replacement);
    }

    @LuaBinding({ name: 'replaceAll' })
    static replaceAll(str: string, pattern: string, replacement: string): string {
        return str.replace(new RegExp(pattern, 'g'), replacement);
    }

    @LuaBinding({ name: 'split' })
    static split(str: string, pattern: string): string[] {
        return str.split(new RegExp(pattern));
    }
}

Deno.test('regex: match returns captures', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new RegexTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`return regex.match("a@b", "(\\\\w+)@(\\\\w+)")`);
        assertEquals(result, ['a@b', 'a', 'b']);
    } finally {
        bridge.close();
    }
});

Deno.test('regex: match returns null when no match', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new RegexTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`return regex.match("hello", "\\\\d+")`);
        assertEquals(result, null);
    } finally {
        bridge.close();
    }
});

Deno.test('regex: test returns boolean', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new RegexTestBindings(ctx)],
    });
    try {
        const t = await bridge.execute(`return regex.test("hello world", "^hello")`);
        assertEquals(t, true);
        const f = await bridge.execute(`return regex.test("hello world", "^world")`);
        assertEquals(f, false);
    } finally {
        bridge.close();
    }
});

Deno.test('regex: replace replaces first occurrence', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new RegexTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`return regex.replace("hello world world", "world", "JS")`);
        assertEquals(result, 'hello JS world');
    } finally {
        bridge.close();
    }
});

Deno.test('regex: replaceAll replaces all occurrences', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new RegexTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`return regex.replaceAll("hello world", "o", "x")`);
        assertEquals(result, 'hellx wxrld');
    } finally {
        bridge.close();
    }
});

Deno.test('regex: split splits string', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new RegexTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`return regex.split("a, b, c", ", ")`);
        assertEquals(result, ['a', 'b', 'c']);
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// JSON bindings
// ---------------------------------------------------------------------------

@LuaBinder({ namespace: 'json' })
class JsonTestBindings extends LuaBindings {
    @LuaBinding({ name: 'stringify' })
    static stringify(value: unknown): string {
        const result = JSON.stringify(value);
        return result !== undefined ? result : 'null';
    }

    @LuaBinding({ name: 'parse' })
    static parse(str: string): unknown {
        return JSON.parse(str);
    }

    @LuaBinding({ name: 'encode' })
    static encode(value: unknown): string {
        return JSON.stringify(value) ?? 'null';
    }

    @LuaBinding({ name: 'decode' })
    static decode(str: string): unknown {
        return JSON.parse(str);
    }
}

Deno.test('json: stringify serialises a Lua table', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new JsonTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`return json.stringify({ a = 1, b = "two" })`);
        // Order of keys is not guaranteed
        const parsed = JSON.parse(result as string);
        assertEquals(parsed.a, 1);
        assertEquals(parsed.b, 'two');
    } finally {
        bridge.close();
    }
});

Deno.test('json: parse returns a Lua table', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new JsonTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`local t = json.parse('{"x":10,"y":20}'); return t.x`);
        assertEquals(result, 10);
    } finally {
        bridge.close();
    }
});

Deno.test('json: parse multi-return yields all values', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new JsonTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`local t = json.parse('{"x":10,"y":20}'); return t.x, t.y`);
        assertEquals(result, [10, 20]);
    } finally {
        bridge.close();
    }
});

Deno.test('json: encode is alias for stringify', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new JsonTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`return json.encode({ n = 42 })`);
        assertEquals(result, '{"n":42}');
    } finally {
        bridge.close();
    }
});

Deno.test('json: decode is alias for parse', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new JsonTestBindings(ctx)],
    });
    try {
        const result = await bridge.execute(`local t = json.decode('[1,2,3]'); return t[2]`);
        assertEquals(result, 2);
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// Timer bindings
// ---------------------------------------------------------------------------

@LuaBinder({ namespace: 'timers', readonly: true })
class TimerTestBindings extends LuaBindings {
    private nextId = 1;
    private active = new Map<number, { type: 'timeout' | 'interval'; jsId: ReturnType<typeof setTimeout> }>();

    constructor(ctx: BindingContext) {
        super(ctx);
    }

    @LuaBinding({ name: 'setTimeout' })
    static setTimeout(callback: (...args: unknown[]) => unknown, delay: number): number {
        const inst = this as unknown as TimerTestBindings;
        const id = inst.nextId++;
        const jsId = globalThis.setTimeout(() => {
            try { callback(); } catch { /* test hook */ }
            finally { inst.active.delete(id); }
        }, delay);
        inst.active.set(id, { type: 'timeout', jsId });
        return id;
    }

    @LuaBinding({ name: 'setInterval' })
    static setInterval(callback: (...args: unknown[]) => unknown, interval: number): number {
        const inst = this as unknown as TimerTestBindings;
        const id = inst.nextId++;
        const jsId = globalThis.setInterval(() => {
            try { callback(); } catch {
                globalThis.clearInterval(jsId);
                inst.active.delete(id);
            }
        }, interval);
        inst.active.set(id, { type: 'interval', jsId });
        return id;
    }

    @LuaBinding({ name: 'clearTimeout' })
    static clearTimeout(id: number): void {
        const inst = this as unknown as TimerTestBindings;
        const entry = inst.active.get(id);
        if (entry?.type === 'timeout') {
            globalThis.clearTimeout(entry.jsId);
            inst.active.delete(id);
        }
    }

    @LuaBinding({ name: 'clearInterval' })
    static clearInterval(id: number): void {
        const inst = this as unknown as TimerTestBindings;
        const entry = inst.active.get(id);
        if (entry?.type === 'interval') {
            globalThis.clearInterval(entry.jsId);
            inst.active.delete(id);
        }
    }

    @LuaBinding({ name: 'clearAll' })
    static clearAll(): void {
        const inst = this as unknown as TimerTestBindings;
        for (const [, entry] of inst.active) {
            if (entry.type === 'timeout') globalThis.clearTimeout(entry.jsId);
            else globalThis.clearInterval(entry.jsId);
        }
        inst.active.clear();
    }

    @LuaBinding({ name: 'activeCount' })
    static activeCount(): number {
        const inst = this as unknown as TimerTestBindings;
        return inst.active.size;
    }
}

Deno.test('timers: setTimeout calls callback', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new TimerTestBindings(ctx)],
    });
    try {
        await bridge.execute('flag = false');
        await bridge.execute(`
            timers.setTimeout(function()
                flag = true
            end, 50)
        `);
        await new Promise<void>((r) => setTimeout(r, 120));
        const flag = await bridge.execute('return flag');
        assertEquals(flag, true);
    } finally {
        bridge.close();
    }
});

Deno.test('timers: clearTimeout cancels pending timeout', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new TimerTestBindings(ctx)],
    });
    try {
        await bridge.execute('flag = false');
        await bridge.execute(`
            local id = timers.setTimeout(function()
                flag = true
            end, 50)
            timers.clearTimeout(id)
        `);
        await new Promise<void>((r) => setTimeout(r, 120));
        const flag = await bridge.execute('return flag');
        assertEquals(flag, false);
    } finally {
        bridge.close();
    }
});

Deno.test('timers: activeCount returns correct count', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new TimerTestBindings(ctx)],
    });
    try {
        const count1 = await bridge.execute('return timers.activeCount()');
        assertEquals(count1, 0);

        await bridge.execute(`
            id1 = timers.setTimeout(function() end, 10000)
            id2 = timers.setTimeout(function() end, 10000)
        `);
        const count2 = await bridge.execute('return timers.activeCount()');
        assertEquals(count2, 2);

        await bridge.execute('timers.clearTimeout(id1)');
        const count3 = await bridge.execute('return timers.activeCount()');
        assertEquals(count3, 1);

        await bridge.execute('timers.clearAll()');
        const count4 = await bridge.execute('return timers.activeCount()');
        assertEquals(count4, 0);
    } finally {
        bridge.close();
    }
});

Deno.test('timers: setInterval fires repeatedly', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new TimerTestBindings(ctx)],
    });
    try {
        await bridge.execute('tick_count = 0');
        await bridge.execute(`
            local id = timers.setInterval(function()
                tick_count = tick_count + 1
            end, 30)
            test_interval_id = id
        `);
        await new Promise<void>((r) => setTimeout(r, 100));
        await bridge.execute('timers.clearInterval(test_interval_id)');
        const count = await bridge.execute('return tick_count') as number;
        assert(count >= 2, `Expected >= 2 ticks, got ${count}`);
    } finally {
        bridge.close();
    }
});

Deno.test('timers: clearInterval stops interval', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new TimerTestBindings(ctx)],
    });
    try {
        await bridge.execute('tick_count = 0');
        await bridge.execute(`
            local id = timers.setInterval(function()
                tick_count = tick_count + 1
            end, 10)
            timers.clearInterval(id)
        `);
        await new Promise<void>((r) => setTimeout(r, 50));
        const count = await bridge.execute('return tick_count');
        assertEquals(count, 0);
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// Shipped bindings — exported from mod.ts
// ---------------------------------------------------------------------------

Deno.test('bindings: built-ins are exported from mod.ts and install', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [globalBindings, jsonBindings, regexBindings, timersBindings],
    });
    try {
        const parsed = await bridge.execute(`local t = json.parse('[10,20]'); return t[2]`);
        assertEquals(parsed, 20);

        const matched = await bridge.execute(`return regex.test("hello world", "^hello")`);
        assertEquals(matched, true);

        assertEquals(await bridge.execute('return js_type(42)'), 'number');

        assertEquals(await bridge.execute('return timers.activeCount()'), 0);
    } finally {
        bridge.close();
    }
});

Deno.test('bindings: readonly namespaces reject overwriting an existing key', async () => {
    const bridge = await createLuaBridge({}, {
        bindings: [jsonBindings, regexBindings],
    });
    try {
        await assertRejects(
            () => bridge.execute('json.stringify = nil'),
            Error,
            'read-only table',
        );

        // Namespace still works after the rejected write
        const out = await bridge.execute('return json.stringify({ a = 1 })');
        assertEquals(out, '{"a":1}');
    } finally {
        bridge.close();
    }
});

// ---------------------------------------------------------------------------
// Misconfiguration guards
// ---------------------------------------------------------------------------

const fakeEngine = {
    global: { set() {}, get() { return undefined; } },
    doString: () => Promise.resolve(undefined),
    doStringSync: () => undefined,
} as unknown as LuaEngineLike;

@LuaBinder({ namespace: 'empty' })
class EmptyBindings extends LuaBindings {}

Deno.test('bindings: @LuaBinder with zero methods throws at install', async () => {
    const binding = new EmptyBindings({ bridge: {} as never });
    await assertRejects(
        () => binding.install(fakeEngine),
        Error,
        'zero @LuaBinding',
    );
});

@LuaBinder({ readonly: true })
class ReadonlyGlobalBindings extends LuaBindings {
    @LuaBinding({ name: 'nope' })
    static nope(): number {
        return 1;
    }
}

Deno.test('bindings: readonly without a namespace throws at install', async () => {
    const binding = new ReadonlyGlobalBindings({ bridge: {} as never });
    await assertRejects(
        () => binding.install(fakeEngine),
        Error,
        "without a 'namespace'",
    );
});

// ---------------------------------------------------------------------------
// TC39 stage-3 decorator convention
// ---------------------------------------------------------------------------

@LuaBinder({ namespace: 'tc39' })
class Tc39Bindings extends LuaBindings {
    static inc(n: number): number {
        return n + 1;
    }
}

Deno.test('bindings: supports TC39 stage-3 method decorators', async () => {
    const apply = LuaBinding({ name: 'inc' }) as unknown as (
        value: unknown,
        context: unknown,
    ) => void;

    let initializer: ((this: unknown) => void) | undefined;
    apply(Tc39Bindings.inc, {
        kind: 'method',
        name: 'inc',
        static: true,
        addInitializer(fn: (this: unknown) => void) {
            initializer = fn;
        },
    });
    assert(initializer, 'expected the TC39 decorator to register an initializer');
    initializer.call(Tc39Bindings);

    const bridge = await createLuaBridge({}, {
        bindings: [(ctx: BindingContext) => new Tc39Bindings(ctx)],
    });
    try {
        assertEquals(await bridge.execute('return tc39.inc(41)'), 42);
    } finally {
        bridge.close();
    }
});
