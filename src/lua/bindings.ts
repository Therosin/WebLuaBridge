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

import { LuaClass } from './lua_class.ts';
import type { BindingContext, LuaEngineLike } from './types.ts';

// ---------------------------------------------------------------------------
// Metadata storage — uses Symbol keys on the class constructor
// ---------------------------------------------------------------------------

const BINDER_OPTIONS = Symbol('LuaBinder:options');
const BINDING_METHODS = Symbol('LuaBinder:methods');

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

export interface LuaBinderOptions {
    /** If set, bindings are placed under `_G[namespace]`. If undefined, they go to `_G` directly. */
    namespace?: string;
    /** If true, the namespace table rejects writes with an error. */
    readonly?: boolean;
    /**
     * Lifecycle hooks called before/after each binding invocation.
     * Implemented via `__index`/`__newindex` metatable interception.
     */
    hooks?: {
        before?: (...args: unknown[]) => void;
        after?: (...args: unknown[]) => void;
    };
    /** If true, the namespace table is callable (via `__call` → calls the class constructor / a registered `__call` method). */
    callable?: boolean;
}

export interface LuaBindingOptions {
    /** Name exposed to Lua. Defaults to the JS method name. */
    name?: string;
    /** Argument descriptors (used for documentation / future validation). */
    args?: Array<{ name: string; type: unknown }>;
    /** Expected return type (used for documentation / future validation). */
    returnType?: unknown;
    /** If true, the first argument is the instance (`self` in Lua method call syntax). */
    isMethod?: boolean;
    /** If true, the binding returns a Promise and yields in Lua. */
    isAsync?: boolean;
}

// ---------------------------------------------------------------------------
// Decorators
// ---------------------------------------------------------------------------

/**
 * Class decorator that marks a `LuaBindings` subclass with namespace
 * and behavior options.
 *
 * @example
 * ```ts
 * @LuaBinder({ namespace: 'MyLib', readonly: true })
 * class MyBindings extends LuaBindings { ... }
 * ```
 */
// reason: decorator constructor signature uses any intentionally
// deno-lint-ignore no-explicit-any
export function LuaBinder(options: LuaBinderOptions): <T extends new (...args: any[]) => any>(constructor: T) => void {
    // reason: decorator constructor signature uses any intentionally
    // deno-lint-ignore no-explicit-any
    return function <T extends new (...args: any[]) => any>(constructor: T): void {
        (constructor as unknown as Record<symbol, LuaBinderOptions>)[BINDER_OPTIONS] = options;
    };
}

/**
 * Method decorator that marks a static method as a Lua-callable binding.
 *
 * @example
 * ```ts
 * @LuaBinding({ name: 'greet' })
 * static greet(name: string): string { return `Hello ${name}`; }
 * ```
 */
export function LuaBinding(options: LuaBindingOptions = {}): (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) => void {
    return function (
        target: unknown,
        propertyKey: string,
        _descriptor: PropertyDescriptor,
    ): void {
        // For static methods, `target` is the constructor function
        const target_ = target as Record<symbol, Array<LuaBindingOptions & { key: string }>>;
        const existing = target_[BINDING_METHODS] || [];
        existing.push({ ...options, key: propertyKey });
        target_[BINDING_METHODS] = existing;
    };
}

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/**
 * Base class for Lua binding modules.
 *
 * Subclass it, add `@LuaBinder` and `@LuaBinding` decorators, and export
 * a default factory function. Pass the factory to `createLuaBridge({ bindings: [...] })`.
 *
 * @example
 * ```ts
 * // src/bindings/my_lib.ts
 * import { LuaBindings, LuaBinder, LuaBinding } from '../lua/bindings.ts';
 *
 * @LuaBinder({ namespace: 'mylib' })
 * class MyLib extends LuaBindings {
 *     @LuaBinding()
 *     static greet(name: string): string {
 *         return `Hello ${name}`;
 *     }
 * }
 *
 * export default (ctx: any) => new MyLib(ctx);
 * ```
 *
 * ```ts
 * // Usage
 * import myLib from './src/bindings/my_lib.ts';
 * const bridge = await createLuaBridge({}, { bindings: [myLib] });
 * await bridge.execute('return mylib.greet("World")'); // "Hello World"
 * ```
 */
export class LuaBindings {
    constructor(public readonly ctx: BindingContext) {}

    /**
     * Called when the bridge is closing.
     * Override to release resources (e.g. cancel timers, close connections).
     * Default is a no-op.
     */
    close(): void {
        // subclass can override
    }

    /**
     * Install all decorated bindings into the Lua environment.
     * Called automatically during `createLuaBridge` initialization.
     */
    async install(lua: LuaEngineLike): Promise<void> {
        const ctor = this.constructor as unknown as {
            [BINDER_OPTIONS]: LuaBinderOptions;
            [BINDING_METHODS]: Array<LuaBindingOptions & { key: string }>;
        };

        const opts: LuaBinderOptions = ctor[BINDER_OPTIONS] || {};
        const methods = ctor[BINDING_METHODS] || [];

        if (methods.length === 0) return;

        const targetName = opts.namespace;

        // Build the LuaClass
        const luaClass = new LuaClass({ name: targetName });

        if (opts.readonly) luaClass.readonly();
        if (opts.callable) luaClass.callable();

        // Add each method — bind `this` to the instance so static methods can access `this.ctx`
        for (const method of methods) {
            const fn = (ctor as unknown as Record<string, unknown>)[method.key] as
                | ((...args: unknown[]) => unknown)
                | undefined;
            if (typeof fn !== 'function') continue;

            const luaName = method.name || method.key;
            const bound = fn.bind(this);

            if (opts.hooks) {
                const { before, after } = opts.hooks;
                const wrapped = (...args: unknown[]): unknown => {
                    before?.apply(this, args);
                    const result = bound(...args);
                    after?.apply(this, args);
                    return result;
                };
                if (targetName) {
                    luaClass.method(luaName, wrapped);
                } else {
                    lua.global.set(luaName, wrapped);
                }
            } else {
                if (targetName) {
                    luaClass.method(luaName, bound);
                } else {
                    lua.global.set(luaName, bound);
                }
            }
        }

        // Install namespace table into Lua
        if (targetName) {
            await luaClass.install(lua, targetName);
        }
    }
}

