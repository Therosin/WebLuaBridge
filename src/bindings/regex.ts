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
 * @module RegexBindings
 *
 * Exposes JavaScript regular expressions to Lua under the `regex` namespace.
 *
 * Usage:
 * ```lua
 * regex.test("^hello", "hello world")        --> true
 * regex.match("(\\w+)@(\\w+)", "a@b")         --> {"a@b", "a", "b"}
 * regex.replace("world", "hello world", "JS") --> "hello JS"
 * regex.replaceAll("o", "hello world", "x")    --> "hellx wxrld"
 * regex.split(", ", "a, b, c")                --> {"a", "b", "c"}
 * ```
 */

import { LuaBindings, LuaBinder, LuaBinding } from '../lua/bindings.ts';

@LuaBinder({ namespace: 'regex' })
export class RegexBindings extends LuaBindings {
    /**
     * Return the first match with captures, or nil if no match.
     * ```lua
     * regex.match("(\\w+)@(\\w+)", "a@b")  --> {"a@b", "a", "b"}
     * ```
     */
    @LuaBinding({ name: 'match' })
    static match(pattern: string, str: string): string[] | null {
        const re = new RegExp(pattern);
        const result = re.exec(str);
        if (!result) return null;
        return Array.from(result);
    }

    /**
     * Return true if the pattern matches anywhere in the string.
     * ```lua
     * regex.test("^hello", "hello world")  --> true
     * ```
     */
    @LuaBinding({ name: 'test' })
    static test(pattern: string, str: string): boolean {
        return new RegExp(pattern).test(str);
    }

    /**
     * Replace the first occurrence of pattern with replacement.
     * ```lua
     * regex.replace("world", "hello world", "JS")  --> "hello JS"
     * ```
     */
    @LuaBinding({ name: 'replace' })
    static replace(pattern: string, str: string, replacement: string): string {
        return str.replace(new RegExp(pattern), replacement);
    }

    /**
     * Replace all occurrences of pattern (global flag added automatically).
     * ```lua
     * regex.replaceAll("o", "hello world", "x")  --> "hellx wxrld"
     * ```
     */
    @LuaBinding({ name: 'replaceAll' })
    static replaceAll(pattern: string, str: string, replacement: string): string {
        return str.replace(new RegExp(pattern, 'g'), replacement);
    }

    /**
     * Split a string by pattern.
     * ```lua
     * regex.split(", ", "a, b, c")  --> {"a", "b", "c"}
     * ```
     */
    @LuaBinding({ name: 'split' })
    static split(pattern: string, str: string): string[] {
        return str.split(new RegExp(pattern));
    }
}

export default (ctx: any) => new RegexBindings(ctx);
