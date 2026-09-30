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

export type LuaBindingRole = 'method' | 'call' | 'index' | 'newIndex';

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

export interface LuaBinderOptions {
    /** If set, bindings are placed under `_G[namespace]`. If undefined, they go to `_G` directly. */
    namespace?: string;
    /** If true, the namespace table rejects writes with an error. Requires `namespace`. */
    readonly?: boolean;
    /**
     * Lifecycle hooks called around each binding invocation. `before` receives
     * the Lua name and arguments; `after` also receives the resolved result;
     * `error` receives the thrown or rejected error. Async hooks are awaited.
     */
    hooks?: {
        before?: (methodName: string, args: unknown[]) => void | Promise<void>;
        after?: (methodName: string, args: unknown[], result: unknown) => void | Promise<void>;
        error?: (methodName: string, args: unknown[], error: unknown) => void | Promise<void>;
    };
    /** If true, the namespace table is callable through a method marked with `@LuaCall`. */
    callable?: boolean;
}

export interface LuaBindingOptions {
    /** Name exposed to Lua. Defaults to the JS method name. */
    name?: string;
    /** Description for generated reference documentation. */
    description?: string;
    /** Argument metadata for binding documentation exporters. */
    args?: Array<{ name: string; type: unknown }>;
    /** Return metadata for binding documentation exporters. */
    returnType?: unknown;
    /** Documentation metadata: this binding is intended for Lua `:` method-call syntax. */
    isMethod?: boolean;
    /** Documentation metadata: the JS implementation returns a Promise. */
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
// reason: decorator constructor signature allows arbitrary constructor parameters
// deno-lint-ignore no-explicit-any
type BindingConstructor = new (...args: any[]) => any;
export type LuaBindingClass = BindingConstructor & { readonly name: string };

export function LuaBinder(
    options: LuaBinderOptions,
): <T extends BindingConstructor>(constructor: T) => void {
    return function <T extends BindingConstructor>(constructor: T): void {
        (constructor as unknown as Record<symbol, LuaBinderOptions>)[
            BINDER_OPTIONS
        ] = options;
    };
}

/**
 * Method decorator that marks a static method as a Lua-callable binding.
 *
 * Supports both decorator conventions:
 * - Legacy TypeScript decorators (`experimentalDecorators: true`)
 * - TC39 stage-3 decorators (TypeScript's default for modern targets and the
 *   convention used by esbuild and other bundlers)
 *
 * @example
 * ```ts
 * @LuaBinding({ name: 'greet' })
 * static greet(name: string): string { return `Hello ${name}`; }
 * ```
 */
type LuaMethodDecorator = (
    target: unknown,
    propertyKeyOrContext: unknown,
    descriptor?: PropertyDescriptor,
) => void;

function luaMethodDecorator(
    role: LuaBindingRole,
    options: LuaBindingOptions = {},
): LuaMethodDecorator {
    return function (
        target: unknown,
        propertyKeyOrContext: unknown,
        _descriptor?: PropertyDescriptor,
    ): void {
        // Legacy decorators: (constructor, propertyKey, descriptor)
        if (
            typeof propertyKeyOrContext === 'string' ||
            typeof propertyKeyOrContext === 'symbol'
        ) {
            registerBinding(
                target,
                options,
                String(propertyKeyOrContext),
                role,
            );
            return;
        }

        // TC39 stage-3 decorators: (value, context: ClassMethodDecoratorContext).
        // The class is not available here, so we defer registration to an
        // initializer, which runs with `this` bound to the class.
        const context = propertyKeyOrContext as {
            kind?: string;
            name?: string | symbol;
            static?: boolean;
            addInitializer?: (initializer: (this: unknown) => void) => void;
        } | null;

        if (!context || context.kind !== 'method') {
            throw new TypeError('@LuaBinding can only be applied to methods');
        }
        if (context.static !== true) {
            throw new TypeError(
                '@LuaBinding must be applied to a static method',
            );
        }
        if (typeof context.addInitializer !== 'function') {
            throw new TypeError(
                '@LuaBinding: unsupported decorator environment (context.addInitializer is missing)',
            );
        }

        const key = String(context.name);
        context.addInitializer(function (this: unknown): void {
            registerBinding(this, options, key, role);
        });
    };
}

export function LuaBinding(
    options: LuaBindingOptions = {},
): LuaMethodDecorator {
    return luaMethodDecorator('method', options);
}

/** Mark a static binding method as the Lua table's callable factory. */
export function LuaCall(options: LuaBindingOptions = {}): LuaMethodDecorator {
    return luaMethodDecorator('call', options);
}

/** Mark a static binding method as the handler for reads of missing Lua fields. */
export function LuaIndex(options: LuaBindingOptions = {}): LuaMethodDecorator {
    return luaMethodDecorator('index', options);
}

/** Mark a static binding method as the handler for Lua field writes. */
export function LuaNewIndex(
    options: LuaBindingOptions = {},
): LuaMethodDecorator {
    return luaMethodDecorator('newIndex', options);
}

type BindingMethodRecord = LuaBindingOptions & {
    key: string;
    role: LuaBindingRole;
};

/** Attach a method binding record to a class constructor's metadata. */
function registerBinding(
    target: unknown,
    options: LuaBindingOptions,
    key: string,
    role: LuaBindingRole,
): void {
    const record = target as Record<symbol, BindingMethodRecord[]>;
    const inherited = record[BINDING_METHODS] || [];
    const existing = Object.prototype.hasOwnProperty.call(record, BINDING_METHODS) ? inherited : [...inherited];
    existing.push({ ...options, key, role });
    record[BINDING_METHODS] = existing;
}

export interface LuaBindingMethodDocs {
    name: string;
    sourceName: string;
    role: LuaBindingRole;
    description?: string;
    args?: LuaBindingOptions['args'];
    returnType?: unknown;
    isMethod?: boolean;
    isAsync?: boolean;
}

/** Structured, exporter-neutral description of a decorated binding class. */
export interface LuaBindingDocs {
    className: string;
    namespace?: string;
    readonly: boolean;
    callable: boolean;
    methods: LuaBindingMethodDocs[];
}

/**
 * Read decorator metadata without creating a binding instance or Lua runtime.
 * The returned structure is intended as input to LuaLS, Markdown, or other
 * documentation exporters. Argument type schema remains the caller's declared
 * value until a shared type vocabulary is defined.
 */
export function bindingDocs(
    bindingClass: LuaBindingClass,
): LuaBindingDocs {
    const ctor = bindingClass as unknown as {
        [BINDER_OPTIONS]?: LuaBinderOptions;
        [BINDING_METHODS]?: BindingMethodRecord[];
    };
    const binder = ctor[BINDER_OPTIONS] ?? {};
    const methods = ctor[BINDING_METHODS] ?? [];
    return {
        className: bindingClass.name,
        ...(binder.namespace === undefined ? {} : { namespace: binder.namespace }),
        readonly: binder.readonly ?? false,
        callable: binder.callable === true ||
            methods.some((m) => m.role === 'call'),
        methods: methods.map((method) => ({
            name: method.name || method.key,
            sourceName: method.key,
            role: method.role,
            ...(method.description === undefined ? {} : { description: method.description }),
            ...(method.args === undefined ? {} : { args: method.args.map((arg) => ({ ...arg })) }),
            ...(method.returnType === undefined ? {} : { returnType: method.returnType }),
            ...(method.isMethod === undefined ? {} : { isMethod: method.isMethod }),
            ...(method.isAsync === undefined ? {} : { isAsync: method.isAsync }),
        })),
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
            [BINDING_METHODS]: BindingMethodRecord[];
        };

        const binderOptions = ctor[BINDER_OPTIONS];
        const hasBinder = binderOptions !== undefined;
        const opts: LuaBinderOptions = binderOptions || {};
        const methods = ctor[BINDING_METHODS] || [];

        if (hasBinder && opts.readonly && !opts.namespace) {
            throw new Error(
                `@LuaBinder on '${this.constructor.name || 'anonymous class'}' sets 'readonly' without a ` +
                    `'namespace'. Global (_G) bindings cannot be made read-only; add a namespace or remove 'readonly'.`,
            );
        }

        if (methods.length === 0) {
            if (hasBinder) {
                throw new Error(
                    `@LuaBinder on '${this.constructor.name || 'anonymous class'}' collected zero @LuaBinding ` +
                        `methods. Ensure the methods are static and decorated with @LuaBinding and that decorators ` +
                        `are enabled (experimentalDecorators or TC39 stage-3).`,
                );
            }
            return;
        }

        const targetName = opts.namespace;
        const specialMethods = methods.filter((method) => method.role !== 'method');
        if (specialMethods.length > 0 && !targetName) {
            throw new Error(
                `@Lua${specialMethods[0].role} requires a named namespace`,
            );
        }

        // Build the LuaClass
        const luaClass = new LuaClass({ name: targetName });

        if (opts.readonly) luaClass.readonly();
        if (opts.callable) luaClass.callable();

        const resolved: Array<
            {
                role: LuaBindingRole;
                luaName: string;
                bound: (...args: unknown[]) => unknown;
            }
        > = [];

        // Add each method — bind `this` to the instance so static methods can access `this.ctx`
        for (const method of methods) {
            const fn = (ctor as unknown as Record<string, unknown>)[method.key] as
                | ((...args: unknown[]) => unknown)
                | undefined;
            if (typeof fn !== 'function') continue;

            const luaName = method.name || method.key;
            const bound = fn.bind(this) as (...args: unknown[]) => unknown;
            const invoke = opts.hooks
                ? (...args: unknown[]): unknown => {
                    const { before, after, error: onError } = opts.hooks!;
                    const isThenable = (value: unknown): value is PromiseLike<unknown> =>
                        value !== null &&
                        (typeof value === 'object' || typeof value === 'function') &&
                        typeof (value as PromiseLike<unknown>).then === 'function';
                    const reportError = (failure: unknown): unknown => {
                        if (!onError) throw failure;
                        let report: unknown;
                        try {
                            report = onError.call(this, luaName, args, failure);
                        } catch {
                            throw failure;
                        }
                        if (isThenable(report)) {
                            return Promise.resolve(report).then(
                                () => { throw failure; },
                                () => { throw failure; },
                            );
                        }
                        throw failure;
                    };
                    const runBinding = (): unknown => {
                        let result: unknown;
                        try {
                            result = bound(...args);
                        } catch (failure) {
                            return reportError(failure);
                        }
                        const runAfter = (settledResult: unknown): unknown => {
                            let afterResult: unknown;
                            try {
                                afterResult = after?.call(this, luaName, args, settledResult);
                            } catch (failure) {
                                return reportError(failure);
                            }
                            return isThenable(afterResult)
                                ? Promise.resolve(afterResult).then(() => settledResult, reportError)
                                : settledResult;
                        };
                        return isThenable(result)
                            ? Promise.resolve(result).then(runAfter, reportError)
                            : runAfter(result);
                    };
                    let beforeResult: unknown;
                    try {
                        beforeResult = before?.call(this, luaName, args);
                    } catch (failure) {
                        return reportError(failure);
                    }
                    return isThenable(beforeResult)
                        ? Promise.resolve(beforeResult).then(runBinding, reportError)
                        : runBinding();
                }
                : bound;
            resolved.push({ role: method.role, luaName, bound: invoke });
        }

        const callHandlers = resolved.filter((method) => method.role === 'call');
        const indexHandlers = resolved.filter((method) => method.role === 'index');
        const newIndexHandlers = resolved.filter((method) => method.role === 'newIndex');
        for (
            const [role, handlers] of [['call', callHandlers], [
                'index',
                indexHandlers,
            ], ['newIndex', newIndexHandlers]] as const
        ) {
            if (handlers.length > 1) {
                throw new Error(
                    `Only one @Lua${role} handler may be registered per binding`,
                );
            }
        }

        // Retain the old __call-name convention for compatibility while
        // directing new bindings toward @LuaCall.
        const legacyCall = opts.callable
            ? resolved.find((method) => method.role === 'method' && method.luaName === '__call')
            : undefined;
        const callHandler = callHandlers[0] ?? legacyCall;

        if (targetName && opts.callable && !callHandler) {
            throw new Error(
                `@LuaBinder on '${this.constructor.name || 'anonymous class'}' enables 'callable' but has no call handler. Add a static @LuaCall method.`,
            );
        }

        for (const method of resolved) {
            if (method.role === 'method') {
                if (targetName) luaClass.method(method.luaName, method.bound);
                else lua.global.set(method.luaName, method.bound);
            }
        }

        if (targetName) {
            if (callHandler) {
                luaClass.call((...args) => callHandler.bound(...args));
            }
            if (indexHandlers[0]) {
                luaClass.index((_self, key) => indexHandlers[0].bound(key));
            }
            if (newIndexHandlers[0]) {
                luaClass.newIndex((_self, key, value) => newIndexHandlers[0].bound(key, value));
            }
        }

        // Install namespace table into Lua
        if (targetName) {
            await luaClass.install(lua, targetName);
        }
    }
}
