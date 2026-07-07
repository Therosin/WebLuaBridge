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
 * @module TimerBindings
 *
 * Tracked, cancelable timer functions exposed to Lua under the `timers` namespace.
 * All active timers can be cleared at once with `timers.clearAll()`.
 *
 * Usage:
 * ```lua
 * local id = timers.setTimeout(function()
 *     print("Fired!")
 * end, 1000)
 * timers.clearTimeout(id)
 *
 * local id2 = timers.setInterval(function()
 *     print("Tick")
 * end, 500)
 * timers.clearInterval(id2)
 *
 * timers.clearAll()
 * print(timers.activeCount())  --> 0
 * ```
 *
 * Errors in timer callbacks are caught and emitted as `timer:error` events
 * on the bridge's Event API. JS code can listen:
 *
 * ```ts
 * bridge.on('timer:error', (msg) => console.error('Timer error:', msg));
 * ```
 *
 * **Cleanup:** Call `timers.clearAll()` before `bridge.close()` to ensure
 * pending timers are properly cancelled.
 *
 * **Edge cases:**
 * - Calling `clearTimeout`/`clearInterval` with an unknown id is a no-op.
 * - Interval callbacks that throw are automatically stopped (no repeated error loops).
 * - `activeCount()` returns the number of currently tracked timers.
 */

import { LuaBindings, LuaBinder, LuaBinding } from '../lua/bindings.ts';
import type { BindingContext } from '../lua/types.ts';

type JsTimerId = ReturnType<typeof setTimeout>;

interface TimerEntry {
    type: 'timeout' | 'interval';
    jsId: JsTimerId;
}

@LuaBinder({ namespace: 'timers', readonly: true })
export class TimerBindings extends LuaBindings {
    private nextId = 1;
    private active = new Map<number, TimerEntry>();

    constructor(ctx: BindingContext) {
        super(ctx);
    }

    /**
     * Call `callback` after `delay` milliseconds.
     * Returns a timer id that can be passed to `clearTimeout`.
     * ```lua
     * local id = timers.setTimeout(function() print("hi") end, 100)
     * ```
     */
    @LuaBinding({ name: 'setTimeout' })
    static setTimeout(callback: (...args: unknown[]) => unknown, delay: number): number {
        if (typeof callback !== 'function') {
            throw new Error('setTimeout: first argument must be a function');
        }
        const inst = this as unknown as TimerBindings;
        const id = inst.nextId++;
        const jsId = globalThis.setTimeout(() => {
            try {
                callback();
            } catch (err) {
                inst.handleError(err);
            } finally {
                inst.active.delete(id);
            }
        }, delay);
        inst.active.set(id, { type: 'timeout', jsId });
        inst.logDebug(`setTimeout #${id} delay=${delay}ms`);
        return id;
    }

    /**
     * Call `callback` repeatedly every `interval` milliseconds.
     * Returns a timer id that can be passed to `clearInterval`.
     * If the callback throws, the interval is automatically stopped.
     * ```lua
     * local id = timers.setInterval(function() print("tick") end, 500)
     * ```
     */
    @LuaBinding({ name: 'setInterval' })
    static setInterval(callback: (...args: unknown[]) => unknown, interval: number): number {
        if (typeof callback !== 'function') {
            throw new Error('setInterval: first argument must be a function');
        }
        const inst = this as unknown as TimerBindings;
        const id = inst.nextId++;
        const jsId = globalThis.setInterval(() => {
            try {
                callback();
            } catch (err) {
                inst.handleError(err);
                // Stop on error to avoid repeated error loops
                globalThis.clearInterval(jsId);
                inst.active.delete(id);
            }
        }, interval);
        inst.active.set(id, { type: 'interval', jsId });
        inst.logDebug(`setInterval #${id} interval=${interval}ms`);
        return id;
    }

    /**
     * Cancel a pending timeout by id (returned from `setTimeout`).
     * No-op if the id is unknown or already fired.
     * ```lua
     * timers.clearTimeout(id)
     * ```
     */
    @LuaBinding({ name: 'clearTimeout' })
    static clearTimeout(id: number): void {
        const inst = this as unknown as TimerBindings;
        const entry = inst.active.get(id);
        if (entry?.type === 'timeout') {
            globalThis.clearTimeout(entry.jsId);
            inst.active.delete(id);
            inst.logDebug(`clearTimeout #${id}`);
        }
    }

    /**
     * Cancel a pending interval by id (returned from `setInterval`).
     * No-op if the id is unknown or already cleared.
     * ```lua
     * timers.clearInterval(id)
     * ```
     */
    @LuaBinding({ name: 'clearInterval' })
    static clearInterval(id: number): void {
        const inst = this as unknown as TimerBindings;
        const entry = inst.active.get(id);
        if (entry?.type === 'interval') {
            globalThis.clearInterval(entry.jsId);
            inst.active.delete(id);
            inst.logDebug(`clearInterval #${id}`);
        }
    }

    /**
     * Cancel all pending timers (both timeouts and intervals).
     * ```lua
     * timers.clearAll()
     * ```
     */
    @LuaBinding({ name: 'clearAll' })
    static clearAll(): void {
        const inst = this as unknown as TimerBindings;
        for (const [, entry] of inst.active) {
            if (entry.type === 'timeout') {
                globalThis.clearTimeout(entry.jsId);
            } else {
                globalThis.clearInterval(entry.jsId);
            }
        }
        const count = inst.active.size;
        inst.active.clear();
        inst.logDebug(`clearAll (${count} timer(s) cancelled)`);
    }

    /**
     * Return the number of currently active (pending) timers.
     * ```lua
     * local n = timers.activeCount()
     * ```
     */
    @LuaBinding({ name: 'activeCount' })
    static activeCount(): number {
        const inst = this as unknown as TimerBindings;
        return inst.active.size;
    }

    /**
     * Called by bridge.close() to cancel all pending timers.
     * Ensures no dangling callbacks fire against a destroyed Lua state.
     */
    override close(): void {
        TimerBindings.clearAll.call(this);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    private handleError(err: unknown): void {
        try {
            this.ctx?.bridge?.emit?.('timer:error', String(err));
        } catch {
            // suppress emit errors
        }
    }

    private logDebug(msg: string): void {
        // In debug mode, emit a timer:debug event
        try {
            this.ctx?.bridge?.emit?.('timer:debug', msg);
        } catch {
            // suppress
        }
    }
}

export default (ctx: BindingContext) => new TimerBindings(ctx);
