/**
 * Tests for VfsRegistry — the virtual filesystem abstraction.
 *
 * Tests VfsRegistry independently with a mock factory, then
 * integration-test with actual Wasmoon factory.
 */
import { assertEquals, assert } from '@std/assert';
import { LuaFactory } from 'wasmoon';
import { VfsRegistry } from '../src/lua/vfs.ts';

// ---------------------------------------------------------------------------
// Pure unit tests — no real Lua factory
// ---------------------------------------------------------------------------

Deno.test('VfsRegistry: stores pending files for deferred mounting', () => {
    const registry = new VfsRegistry(null as unknown as LuaFactory);
    registry.addPending('test.lua', 'return 42');
    registry.addPending('lib.lua', 'return {x=1}');

    // No mounted files yet
    assertEquals(registry.has('test.lua'), false);
    assertEquals(registry.getPendingCount(), 2);
});

Deno.test('VfsRegistry: new registry has no pending files', () => {
    const registry = new VfsRegistry(null as unknown as LuaFactory);
    assertEquals(registry.getPendingCount(), 0);
    assertEquals(registry.has('nope.lua'), false);
});

Deno.test('VfsRegistry: clearPending removes pending but not mounted', () => {
    const registry = new VfsRegistry(null as unknown as LuaFactory);
    registry.addPending('pending.lua', 'return 1');
    registry.addPending('pending2.lua', 'return 2');
    assertEquals(registry.getPendingCount(), 2);

    registry.clearPending();
    assertEquals(registry.getPendingCount(), 0);
});

Deno.test('VfsRegistry: getFiles returns pending file list', () => {
    const registry = new VfsRegistry(null as unknown as LuaFactory);
    registry.addPending('a.lua', '1');
    registry.addPending('b.lua', '2');
    const files = registry.getFiles();
    assertEquals(files.size, 2);
    assertEquals(files.get('a.lua'), '1');
    assertEquals(files.get('b.lua'), '2');
});

// ---------------------------------------------------------------------------
// Integration tests — use actual Wasmoon factory
// ---------------------------------------------------------------------------

Deno.test('VfsRegistry: mount pending files and track them', async () => {
    const factory = new LuaFactory();
    const registry = new VfsRegistry(factory);

    registry.addPending('hello.lua', 'return "hello from vfs"');
    registry.addPending('nested/lib.lua', 'return {version=2}');

    await registry.mountPending();

    assert(registry.has('hello.lua'), 'hello.lua should be mounted');
    assert(registry.has('nested/lib.lua'), 'nested/lib.lua should be mounted');
    assertEquals(registry.getPendingCount(), 0, 'pending should be cleared after mount');
});

Deno.test('VfsRegistry: mount individual file immediately', async () => {
    const factory = new LuaFactory();
    const registry = new VfsRegistry(factory);

    await registry.mount('immediate.lua', 'return 100');
    assert(registry.has('immediate.lua'));
    // Actually verify it's runnable
    const engine = await factory.createEngine({});
    const raw = await engine.doFile('immediate.lua');
    const result = raw as unknown as number;
    assertEquals(result, 100);
    engine.global.close();
});

Deno.test('VfsRegistry: has returns false for never-mounted files', () => {
    const registry = new VfsRegistry(null as unknown as LuaFactory);
    assertEquals(registry.has('never.lua'), false);
});

Deno.test('VfsRegistry: mountPending is idempotent', async () => {
    const factory = new LuaFactory();
    const registry = new VfsRegistry(factory);

    registry.addPending('idempotent.lua', 'return 1');
    await registry.mountPending();
    assert(registry.has('idempotent.lua'));

    // Second mountPending should be a no-op
    await registry.mountPending();
    assert(registry.has('idempotent.lua'));
});

Deno.test('VfsRegistry: mountFile twice updates content', async () => {
    const factory = new LuaFactory();
    const registry = new VfsRegistry(factory);

    await registry.mount('version.lua', 'return 1');
    const engine = await factory.createEngine({});
    assertEquals(await engine.doFile('version.lua') as number, 1);

    // Mount again with new content
    await registry.mount('version.lua', 'return 2');
    assertEquals(await engine.doFile('version.lua') as number, 2);
    engine.global.close();
});

Deno.test('VfsRegistry: files survive across close — no reset of tracked state', async () => {
    const factory = new LuaFactory();
    const registry = new VfsRegistry(factory);
    registry.addPending('survivor.lua', 'return "alive"');

    // Not mounted yet
    assert(!registry.has('survivor.lua'), 'not mounted yet');

    // Mount pending as init would
    await registry.mountPending();
    assert(registry.has('survivor.lua'), 'should be mounted after mountPending');
    assertEquals(registry.getPendingCount(), 0, 'pending cleared');

    // Simulate close/reset/init cycle — VFS state persists
    registry.clearPending();
    assert(registry.has('survivor.lua'), 'mounted file survives clearPending');
});
