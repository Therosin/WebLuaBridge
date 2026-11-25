// @ts-nocheck

/**
 * Build script for the self-contained ESM bundle.
 *
 * 1. Locates wasmoon's `glue.wasm` in Deno's npm cache
 * 2. Base64-encodes it into a data URI
 * 3. Generates `browser/wasm_inline.ts` with the URI
 * 4. Bundles with esbuild for both full and minified outputs
 * 5. Cleans up the generated file
 */

import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fromFileUrl } from '@std/path';

const require = createRequire(import.meta.url);

/**
 * esbuild plugin that resolves Deno's `npm:<pkg>[@<version>]` specifiers
 * to the actual node_modules location using Node's require.resolve.
 */
function denoNpmResolver(): esbuild.Plugin {
    return {
        name: 'deno-npm',
        setup(build) {
            build.onResolve({ filter: /^npm:/ }, (args) => {
                // Parse: npm:wasmoon@1.16.0 → wasmoon
                const spec = args.path.replace(/^npm:/, '');
                const [pkg] = spec.split('@').filter(Boolean);
                const resolved = require.resolve(pkg, { paths: [args.resolveDir] });
                return { path: resolved };
            });
        },
    };
}

/**
 * esbuild plugin that injects the base64-encoded WASM URI for `./wasm_inline.ts`
 * without mutating files on disk.
 */
function wasmInlinePlugin(dataUri: string): esbuild.Plugin {
    return {
        name: 'wasm-inline',
        setup(build) {
            build.onResolve({ filter: /wasm_inline\.ts$/ }, (args) => ({
                path: args.path,
                namespace: 'wasm-inline',
            }));
            build.onLoad({ filter: /.*/, namespace: 'wasm-inline' }, () => ({
                contents: `export const WASM_URI: string = ${JSON.stringify(dataUri)};`,
                loader: 'ts',
            }));
        },
    };
}

/**
 * esbuild plugin that stubs Node.js built-in modules not needed for browser bundles.
 * Wasmoon references `url` and `module` in conditional Node.js code paths.
 */
function nodeBuiltinStub(): esbuild.Plugin {
    const stubs = new Map<string, string>([
        ['url', 'export const pathToFileURL = () => {};'],
        ['module', 'export default {};'],
    ]);
    return {
        name: 'node-builtin-stub',
        setup(build) {
            build.onResolve({ filter: /^(url|module)$/ }, (args) => {
                // Only stub if the importer is from node_modules (i.e. wasmoon)
                if (args.importer && (args.importer.includes('node_modules') || args.importer.includes('.deno'))) {
                    return { path: args.path, namespace: 'node-stub' };
                }
            });
            build.onLoad({ filter: /.*/, namespace: 'node-stub' }, (args) => {
                return { contents: stubs.get(args.path) || 'export default {};', loader: 'js' };
            });
        },
    };
}

function getDenoDir(): string {
    const envDir = Deno.env.get('DENO_DIR');
    if (envDir) return envDir;

    const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '';
    if (Deno.build.os === 'windows') {
        const localAppData = Deno.env.get('LOCALAPPDATA') || `${home}\\AppData\\Local`;
        return `${localAppData}\\deno`;
    }
    return `${home}/.cache/deno`;
}

async function findWasmoonWasm(): Promise<string> {
    // Use require.resolve to find wasmoon's package root
    try {
        const denoDir = getDenoDir();
        const npmCacheRoot = join(denoDir, 'npm', 'registry.npmjs.org');
        const pkgJsonPath = require.resolve('wasmoon/package.json', { paths: [npmCacheRoot] });
        const pkgDir = dirname(pkgJsonPath);
        const wasmPath = join(pkgDir, 'dist', 'glue.wasm');
        const stat = await Deno.stat(wasmPath);
        if (stat.isFile) return wasmPath;
    } catch {
        // fall through to fallback
    }

    // Fallback: try the exact version path
    const denoDir = getDenoDir();
    const fallback = join(denoDir, 'npm', 'registry.npmjs.org', 'wasmoon', '1.16.0', 'dist', 'glue.wasm');
    try {
        const stat = await Deno.stat(fallback);
        if (stat.isFile) return fallback;
    } catch {
        // fall through
    }

    throw new Error(
        'Could not find wasmoon glue.wasm in Deno npm cache.\n' +
        'Run `deno cache --reload wasmoon@1.16.0` first.',
    );
}

async function base64EncodeFile(path: string): Promise<string> {
    const bytes = await Deno.readFile(path);
    // Chunked conversion to avoid argument spread limit
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function resolveRoot(): string {
    const repoRootUrl = new URL('..', import.meta.url);
    return fromFileUrl(repoRootUrl);
}

async function main() {
    const repoRoot = resolveRoot();
    const distDir = `${repoRoot}dist`;
    const browserDir = `${repoRoot}browser`;

    console.log('🔍 Locating wasmoon WASM binary...');
    const wasmPath = await findWasmoonWasm();
    console.log(`  Found: ${wasmPath}`);

    console.log('📦 Base64-encoding WASM...');
    const base64 = await base64EncodeFile(wasmPath);
    const dataUri = `data:application/octet-stream;base64,${base64}`;
    const wasmSizeKb = (base64.length * 0.75 / 1024).toFixed(1);
    console.log(`  Data URI: ${(dataUri.length / 1024).toFixed(1)} KB (WASM: ${wasmSizeKb} KB)`);

    try {
        // Ensure dist dir exists
        try {
            await Deno.mkdir(distDir, { recursive: true });
        } catch { /* ok */ }

        // Shared esbuild options (no outdir/outfile — set per-build)
        const baseOptions = (): esbuild.BuildOptions => ({
            entryPoints: [`${browserDir}/entry.ts`],
            bundle: true,
            format: 'esm',
            platform: 'browser',
            target: 'es2020',
            treeShaking: true,
            sourcemap: 'external',
            banner: {
                // This artifact deliberately uses Wasmoon's web loader because
                // its WASM is an inlined data URI. Node 18+ supplies the Web APIs
                // it needs, but must not be allowed to select Emscripten's
                // filesystem-backed Node loader.
                js: 'var process = undefined; var window = globalThis; var location = globalThis.location ?? { href: import.meta.url };',
            },
            plugins: [wasmInlinePlugin(dataUri), denoNpmResolver(), nodeBuiltinStub()],
        });

        // Bundle full version
        console.log('📦 Bundling (full)...');
        await esbuild.build({
            ...baseOptions(),
            outfile: `${distDir}/webluabridge.bundle.js`,
        });

        // Bundle minified version
        console.log('📦 Bundling (minified)...');
        await esbuild.build({
            ...baseOptions(),
            outfile: `${distDir}/webluabridge.bundle.min.js`,
            minify: true,
        });

        // Verify bundle sizes
        const fullStat = await Deno.stat(`${distDir}/webluabridge.bundle.js`);
        const minStat = await Deno.stat(`${distDir}/webluabridge.bundle.min.js`);
        console.log(`✅ Bundle sizes:`);
        console.log(`   webluabridge.bundle.js       ${(fullStat.size / 1024).toFixed(1)} KB`);
        console.log(`   webluabridge.bundle.min.js   ${(minStat.size / 1024).toFixed(1)} KB`);
    } finally {
        // Stop esbuild
        esbuild.stop();
    }
}

if (import.meta.main) {
    await main();
}
