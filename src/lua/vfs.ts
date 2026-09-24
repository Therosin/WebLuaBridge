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

/**
 * @module VfsRegistry
 *
 * Virtual filesystem registry for Wasmoon's in-memory Lua filesystem.
 *
 * Manages pending (deferred) file registrations and mounted file tracking
 * through a single abstraction so the bridge doesn't manage raw
 * `Record<string, string>` and `Set<string>` directly.
 *
 * Files survive `close()`/`reset()` lifecycle transitions — only the
 * pending queue is cleared after mounting.
 */

// reason: inline npm specifier keeps wasmoon resolvable by consumer bundlers
// (esbuild) that do not inherit this repo's import map.
// deno-lint-ignore no-import-prefix
import type { LuaFactory } from 'npm:wasmoon@1.16.0';

export class VfsRegistry {
    /** Pending files to be mounted during next mountPending() call. */
    private pending: Map<string, string>;
    /** Set of already-mounted file paths. */
    private mounted: Set<string>;
    /** Wasmoon factory used to mount files into the Lua filesystem. */
    private factory: LuaFactory | null;

    constructor(factory: LuaFactory | null) {
        this.pending = new Map();
        this.mounted = new Set();
        this.factory = factory;
    }

    /**
     * Register a file for deferred mounting.
     *
     * The file will be mounted when `mountPending()` is called (typically
     * during `bridge.init()`). This is used for the `files` option passed
     * to `createLuaBridge()`.
     */
    addPending(path: string, content: string): void {
        this.pending.set(path, content);
    }

    /**
     * Mount all pending files into the Lua filesystem.
     *
     * Idempotent: after mounting, the pending queue is cleared and
     * subsequent calls are no-ops (pending is already empty).
     */
    async mountPending(): Promise<void> {
        if (!this.factory || this.pending.size === 0) return;
        for (const [path, content] of this.pending) {
            await this.factory.mountFile(path, content);
            this.mounted.add(path);
        }
        this.pending.clear();
    }

    /**
     * Mount a single file immediately.
     *
     * This is equivalent to calling `mountFile()` on the bridge directly.
     * If the path was already mounted, the content is overwritten.
     */
    async mount(path: string, content: string): Promise<void> {
        if (!this.factory) throw new Error('VfsRegistry: no factory available for mount');
        await this.factory.mountFile(path, content);
        this.mounted.add(path);
    }

    /**
     * Check whether a file path has been mounted.
     */
    has(path: string): boolean {
        return this.mounted.has(path);
    }

    /**
     * Return the number of pending (not yet mounted) files.
     */
    getPendingCount(): number {
        return this.pending.size;
    }

    /**
     * Return a copy of all pending files (path → content).
     */
    getFiles(): ReadonlyMap<string, string> {
        return new Map(this.pending);
    }

    /**
     * Return the set of mounted file paths.
     */
    getMountedFiles(): ReadonlySet<string> {
        return new Set(this.mounted);
    }

    /**
     * Clear pending files without mounting them.
     * Called during `reset()` to discard unprocessed pending files.
     */
    clearPending(): void {
        this.pending.clear();
    }
}
