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

import type { EventHandler, LuaBridgeEventMap } from './types.ts';

/**
 * Internal event bus shared by Lua and JS callers.
 *
 * Stores listeners by string key and supports stable removal through returned unsubscribe callbacks.
 */
export class BridgeEventBus<TEvents extends LuaBridgeEventMap = LuaBridgeEventMap> {
    /** Map of event names to listener sets. */
    private listeners: Map<string, Set<EventHandler>>;

    constructor() {
        this.listeners = new Map();
    }

    /** Register a listener and return an unsubscribe function. */
    on(event: string, handler: EventHandler): () => boolean {
        if (typeof event !== 'string' || event.length === 0) {
            throw new Error('Event name must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('Event handler must be a function');
        }

        let handlers = this.listeners.get(event);
        if (!handlers) {
            handlers = new Set();
            this.listeners.set(event, handlers);
        }
        handlers.add(handler);

        return () => this.off(event, handler);
    }

    /** Remove a listener from a named event. */
    off(event: string, handler: EventHandler): boolean {
        const handlers = this.listeners.get(event);
        if (!handlers) {
            return false;
        }

        const removed = handlers.delete(handler);
        if (handlers.size === 0) {
            this.listeners.delete(event);
        }
        return removed;
    }

    /** Emit an event and return number of handlers that were invoked. */
    emit(event: string, ...args: unknown[]): number {
        const handlers = this.listeners.get(event);
        if (!handlers || handlers.size === 0) {
            return 0;
        }

        let invoked = 0;
        for (const handler of [...handlers]) {
            handler(...args);
            invoked += 1;
        }
        return invoked;
    }
}
