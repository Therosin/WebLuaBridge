const bundles = [
    '../dist/webluabridge.bundle.js',
    '../dist/webluabridge.bundle.min.js',
];

const requiredExports = [
    'default',
    'LuaBridge',
    'createLuaBridge',
    'runLuaCode',
    'LuaClass',
    'LuaBindings',
    'bindingDocs',
    'LuaBinder',
    'LuaBinding',
    'LuaCall',
    'LuaIndex',
    'LuaNewIndex',
    'BridgeError',
    'ErrorCodes',
    'globalBindings',
    'jsonBindings',
    'regexBindings',
    'timersBindings',
];

for (const bundle of bundles) {
    const module = await import(bundle);
    for (const name of requiredExports) {
        if (module[name] === undefined) {
            throw new Error(`${bundle} is missing export: ${name}`);
        }
    }
    const bridge = await module.createLuaBridge({ hostValue: 40 });

    try {
        await bridge.mountFile(
            'game/math.lua',
            'local M = {}; function M.add(a, b) return a + b end; return M',
        );
        const result = await bridge.execute(
            'local math = require("game/math"); return math.add(hostValue, 2)',
        );

        if (result !== 42) {
            throw new Error(`${bundle} returned ${String(result)} instead of 42`);
        }

        console.log(`Node ESM smoke test passed: ${bundle}`);
    } finally {
        bridge.close();
    }
}
