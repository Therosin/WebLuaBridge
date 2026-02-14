import { createLuaBridge } from '../mod.ts';

export async function main({ intervalMs = 100, runMs = 450 } = {}) {
    const bridge = await createLuaBridge({ hostName: 'HostApp' });
    try {
        const initLuaPath = new URL('./lifecycle/init.lua', import.meta.url);
        const initLua = await Deno.readTextFile(initLuaPath);
        await bridge.mountFile('init.lua', initLua);

        await bridge.start({ intervalMs });
        await new Promise((resolve) => setTimeout(resolve, runMs));
        await bridge.shutdown();
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
