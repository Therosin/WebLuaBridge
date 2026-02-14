import { main as runBasic } from '../examples/basic-run.ts';
import { main as runEnvironment } from '../examples/environment-plugin.ts';
import { main as runEvents } from '../examples/events-bridge.ts';
import { main as runLifecycle } from '../examples/lifecycle-mainloop.ts';

Deno.test('examples: basic-run', async () => {
    await runBasic();
});

Deno.test('examples: environment-plugin', async () => {
    await runEnvironment();
});

Deno.test('examples: events-bridge', async () => {
    await runEvents();
});

Deno.test('examples: lifecycle-mainloop', async () => {
    await runLifecycle({ intervalMs: 10, runMs: 50 });
});
