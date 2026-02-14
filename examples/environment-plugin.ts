import { createLuaBridge } from '../mod.ts';

export async function main() {
    const bridge = await createLuaBridge();
    try {
        const sharedCache = new Map();
        const pluginEnv = {
            name: 'plugin.alpha',
            hits: 0,
            cache: sharedCache,
        };

        const plugin = await bridge.useEnvironment(pluginEnv);

        await plugin.execute(`
            hits = hits + 1
            cache:set("lastPlugin", name)
        `);

        const result = await plugin.execute(`
            hits = hits + 1
            return {
                name = name,
                hits = hits,
            }
        `);

        console.log('plugin result =', result);
        console.log('env.hits =', pluginEnv.hits);
        console.log('cache.lastPlugin =', sharedCache.get('lastPlugin'));
    } finally {
        bridge.close();
    }
}

if (import.meta.url === Deno.mainModule) {
    main().catch((error) => {
        console.error(error);
        Deno.exit(1);
    });
}
