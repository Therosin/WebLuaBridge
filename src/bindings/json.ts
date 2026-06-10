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
 * @module JsonBindings
 *
 * Exposes JSON parse/stringify to Lua under the `json` namespace.
 *
 * Usage:
 * ```lua
 * json.stringify({ a = 1, b = { c = true } })  --> '{"a":1,"b":{"c":true}}'
 * json.parse('{"a":1,"b":2}')                    --> { a = 1, b = 2 }
 * json.encode({ x = 10 })                        -- alias for stringify
 * json.decode('[1,2,3]')                         -- alias for parse
 * ```
 *
 * Errors (circular references, malformed JSON) propagate as Lua errors.
 */

import { LuaBindings, LuaBinder, LuaBinding } from '../lua/bindings.ts';

@LuaBinder({ namespace: 'json' })
export class JsonBindings extends LuaBindings {
    /**
     * Serialize a value to a JSON string.
     * Returns `"null"` for `undefined`/functions (JavaScript edge cases).
     * ```lua
     * json.stringify({ a = 1 })  --> '{"a":1}'
     * ```
     */
    @LuaBinding({ name: 'stringify' })
    static stringify(value: unknown): string {
        const result = JSON.stringify(value);
        return result !== undefined ? result : 'null';
    }

    /**
     * Parse a JSON string into a Lua table.
     * ```lua
     * json.parse('{"a":1}')  --> { a = 1 }
     * ```
     */
    @LuaBinding({ name: 'parse' })
    static parse(str: string): unknown {
        return JSON.parse(str);
    }

    /**
     * Alias for `stringify`. Conforms to Web Lua API naming conventions.
     * ```lua
     * json.encode({ a = 1 })
     * ```
     */
    @LuaBinding({ name: 'encode' })
    static encode(value: unknown): string {
        const result = JSON.stringify(value);
        return result !== undefined ? result : 'null';
    }

    /**
     * Alias for `parse`. Conforms to Web Lua API naming conventions.
     * ```lua
     * json.decode('{"a":1}')
     * ```
     */
    @LuaBinding({ name: 'decode' })
    static decode(str: string): unknown {
        return JSON.parse(str);
    }
}

export default (ctx: any) => new JsonBindings(ctx);
