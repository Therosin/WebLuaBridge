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
 * @module GlobalBindings
 *
 * Example binding module that registers utility functions into the global
 * Lua namespace (`_G`). Demonstrates the `@LuaBinder`/`@LuaBinding` pattern.
 *
 * Usage:
 * ```ts
 * import globalBindings from './src/bindings/global.ts';
 * const bridge = await createLuaBridge({}, { bindings: [globalBindings] });
 * // Now Lua can call:  js_type(42), js_sleep(100), etc.
 * ```
 */

import type { BindingContext } from '../lua/types.ts';
import { LuaBindings, LuaBinder, LuaBinding } from '../lua/bindings.ts';

@LuaBinder({})
export class GlobalBindings extends LuaBindings {
    /** Return the JS type name of a value. */
    @LuaBinding({ name: 'js_type' })
    static jsType(value: unknown): string {
        return typeof value;
    }

    /** Return `true` — useful for Lua truthiness checks. */
    @LuaBinding({ name: 'js_true' })
    static jsTrue(): boolean {
        return true;
    }

    /** Return the length of a string or array. */
    @LuaBinding({ name: 'js_len' })
    static jsLen(value: unknown): number {
        if (typeof value === 'string' || Array.isArray(value)) return value.length;
        if (typeof value === 'object' && value !== null) return Object.keys(value).length;
        return 0;
    }
}

export default (ctx: BindingContext) => new GlobalBindings(ctx);
