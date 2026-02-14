import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createLuaBridge } from '../src/lua_bridge.ts';

export async function main({ intervalMs = 100, runMs = 450 } = {}) {
    const bridge = await createLuaBridge({ hostName: 'HostApp' });
    try {
        const initLuaPath = fileURLToPath(new URL('./lifecycle/init.lua', import.meta.url) as any);
        const initLua = await readFile(initLuaPath, 'utf8');
        await bridge.mountFile('init.lua', initLua);

        await bridge.start({ intervalMs });
        await new Promise((resolve) => setTimeout(resolve, runMs));
        await bridge.shutdown();
    } finally {
        bridge.close();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
