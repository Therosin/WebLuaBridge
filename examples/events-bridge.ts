import { createLuaBridge } from '../mod.ts';

export async function main() {
    const bridge = await createLuaBridge();
    try {
        const unsubscribe = bridge.on('plugin:ready', (id: string) => {
            console.log('[JS] plugin ready:', id);
        });

        await bridge.execute(`
            Events:On("plugin:data", function(payload)
                print("[Lua] plugin:data => " .. tostring(payload))
            end)
        `);

        await bridge.execute(`Events:Emit("plugin:ready", "alpha")`);
        bridge.emit('plugin:data', 'hello-from-js');

        unsubscribe();
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
