import { createLuaBridge } from '../mod.ts';

export async function main() {
    const bridge = await createLuaBridge({ appName: 'WebLuaBridgeExample' });
    try {
        const sum = await bridge.execute(`
            function add(a, b)
                return a + b
            end
            return add(20, 22)
        `);
        console.log('sum =', sum);

        await bridge.mountFile(
            'hello.lua',
            `
            print("Hello from mounted file, " .. appName)
            return 123
            `,
        );

        const fileResult = await bridge.executeFile('hello.lua');
        console.log('fileResult =', fileResult);
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
