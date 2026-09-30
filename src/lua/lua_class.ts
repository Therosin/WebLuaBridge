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

import type { LuaEngineLike } from './types.ts';

// ---------------------------------------------------------------------------
// Lua helper — installed once into the Lua state
// ---------------------------------------------------------------------------

const HELPER_NAME = '__lua_class_helper';

function buildHelperCode(): string {
    return `
    ${HELPER_NAME} = function(config)
        local data = {}
        for k, v in pairs(config.values or {}) do
            data[k] = v
        end

        local mt = {}
        mt.__metatable = false

        -- Read-only tables expose an empty proxy table backed by 'data'.
        -- Because the visible table has no keys, every write (including
        -- assigning nil to an existing key) is an absent-key assignment and
        -- therefore always triggers __newindex.
        local target = config.readonly and {} or data

        local call_handler = config.call_handler or data.__call
        if config.callable and call_handler then
            mt.__call = function(_, ...)
                return call_handler(...)
            end
        end

        if config.readonly then
            if config.index then
                mt.__index = function(self, k)
                    local value = data[k]
                    if value ~= nil then return value end
                    return config.index(self, k)
                end
            else
                mt.__index = data
            end
            mt.__newindex = function(_, k)
                error("Cannot modify read-only table '" .. tostring(config.name) .. "'", 2)
            end
        else
            if config.index then
                mt.__index = config.index
            end
            if config.newindex then
                mt.__newindex = config.newindex
            end
        end

        return setmetatable(target, mt)
    end
`;
}

// ---------------------------------------------------------------------------
// LuaClass
// ---------------------------------------------------------------------------

/**
 * A JS abstraction for a Lua table with metatable behaviors.
 *
 * Create one, add methods/values, configure readonly/callable/custom index,
 * then install it into the Lua state. LuaClass instances can also be passed
 * directly to `bridge.Set()` — it will detect the type and install
 * automatically.
 *
 * @example
 * ```ts
 * const cls = new LuaClass({ name: 'MyClass' })
 *   .method('greet', (name: string) => `Hello ${name}!`)
 *   .readonly();
 * await cls.install(lua, 'MyClass');
 * ```
 */
export class LuaClass {
    private static counter = 0;

    private _values = new Map<string, unknown>();
    private _options: {
        name: string;
        readonly: boolean;
        callable: boolean;
        callHandler?: (...args: unknown[]) => unknown;
        hasCustomIndex: boolean;
        hasCustomNewIndex: boolean;
        indexHandler?: (self: unknown, key: string) => unknown;
        newIndexHandler?: (self: unknown, key: string, value: unknown) => void;
    };

    constructor(options?: { name?: string }) {
        this._options = {
            name: options?.name ?? 'LuaClass',
            readonly: false,
            callable: false,
            hasCustomIndex: false,
            hasCustomNewIndex: false,
        };
    }

    /** Add a method (JS function) to the Lua table. */
    // deno-lint-ignore no-explicit-any
    method(name: string, fn: (...args: any[]) => unknown): this {
        if (typeof fn !== 'function') {
            throw new Error(
                `LuaClass.method(${name}): value must be a function`,
            );
        }
        this._values.set(name, fn);
        return this;
    }

    /** Add a constant value to the Lua table. */
    value(key: string, val: unknown): this {
        this._values.set(key, val);
        return this;
    }

    /** Make the namespace reject writes with an error. */
    readonly(v: boolean = true): this {
        this._options.readonly = v;
        return this;
    }

    /** Enable the `__call` metamethod. Pair with call(handler) or legacy method("__call", handler). */
    callable(v: boolean = true): this {
        this._options.callable = v;
        return this;
    }

    /** Make the table callable through an explicit JS handler. */
    call<TArgs extends unknown[]>(handler: (...args: TArgs) => unknown): this {
        if (typeof handler !== 'function') {
            throw new Error('LuaClass.call(): handler must be a function');
        }
        this._options.callHandler = handler as (...args: unknown[]) => unknown;
        this._options.callable = true;
        return this;
    }

    /** Provide a custom `__index` handler — a JS function called when Lua reads a missing key. */
    // reason: Lua metatable index handler receives raw table reference
    // deno-lint-ignore no-explicit-any
    index(handler: (self: any, key: string) => any): this {
        this._options.indexHandler = handler;
        this._options.hasCustomIndex = true;
        return this;
    }

    /** Provide a custom `__newindex` handler — called when Lua writes a key. */
    // reason: Lua metatable index handler receives raw table reference
    // deno-lint-ignore no-explicit-any
    newIndex(handler: (self: any, key: string, value: any) => void): this {
        this._options.newIndexHandler = handler;
        this._options.hasCustomNewIndex = true;
        return this;
    }

    /**
     * Asynchronously install this class into a Lua engine.
     * The resulting table is set as `_G[name]`.
     */
    async install(lua: LuaEngineLike, name: string): Promise<void> {
        await this.ensureHelper(lua);
        await this.createTable(lua, name);
    }

    /**
     * Synchronously install this class into a Lua engine.
     * Uses `doStringSync` internally. Called automatically by `bridge.Set()`.
     */
    installSync(lua: LuaEngineLike, name: string): void {
        this.ensureHelperSync(lua);
        this.createTableSync(lua, name);
    }

    // ---------------------------------------------------------------------------
    // Internal — async path
    // ---------------------------------------------------------------------------

    private async ensureHelper(lua: LuaEngineLike): Promise<void> {
        if (this.isHelperInstalled(lua)) return;
        await lua.doString(buildHelperCode());
    }

    private async createTable(lua: LuaEngineLike, name: string): Promise<void> {
        const config = this.buildConfig(name);
        const configKey = `__lcc_${LuaClass.counter++}`;
        lua.global.set(configKey, config);
        await lua.doString(`
            local config = _G["${configKey}"]
            _G["${name}"] = ${HELPER_NAME}(config)
            _G["${configKey}"] = nil
        `);
    }

    // ---------------------------------------------------------------------------
    // Internal — sync path
    // ---------------------------------------------------------------------------

    private ensureHelperSync(lua: LuaEngineLike): void {
        if (this.isHelperInstalled(lua)) return;
        lua.doStringSync(buildHelperCode());
    }

    private createTableSync(lua: LuaEngineLike, name: string): void {
        const config = this.buildConfig(name);
        const configKey = `__lcc_${LuaClass.counter++}`;
        lua.global.set(configKey, config);
        lua.doStringSync(`
            local config = _G["${configKey}"]
            _G["${name}"] = ${HELPER_NAME}(config)
            _G["${configKey}"] = nil
        `);
    }

    // ---------------------------------------------------------------------------
    // Shared
    // ---------------------------------------------------------------------------

    private isHelperInstalled(lua: LuaEngineLike): boolean {
        try {
            return typeof lua.global.get(HELPER_NAME) === 'function';
        } catch {
            return false;
        }
    }

    private buildConfig(name: string): Record<string, unknown> {
        const config: Record<string, unknown> = {
            name: name,
            values: Object.fromEntries(this._values),
            readonly: this._options.readonly,
            callable: this._options.callable,
        };

        if (this._options.callHandler) {
            config.call_handler = this._options.callHandler;
        }

        if (this._options.hasCustomIndex) {
            config.index = this._options.indexHandler;
        }
        if (this._options.hasCustomNewIndex) {
            config.newindex = this._options.newIndexHandler;
        }

        return config;
    }

}
