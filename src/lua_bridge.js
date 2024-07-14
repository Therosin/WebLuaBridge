import { LuaFactory } from 'wasmoon';
// import { Buffer } from 'buffer';
// window.Buffer = Buffer;

/**
 * Wraps the code in an anonymous function and injects the args array
 * @param {string} code - The Lua code to wrap
 * @returns {string} - The wrapped Lua code
 * @example
 * const code = `
 *    local function multiply(a, b)
 *       return a * b  
 *    end
 *   return multiply(...)
 * `;
 */
const LuaWrap = (code) => {
    return `
        local args = args or {}
        local function main(...)
            ${code}
        end
        return main(table.unpack(args))
    `;
};

class LuaBridge {
    /**
     * Creates a new LuaBridge instance
     * @param {Object} [globals={}] - Global variables to inject into the Lua environment
     */
    constructor(globals = {}) {
        this.factory = new LuaFactory();
        this.globals = globals;
        this.lua = null;
    }


    /**
     * Initializes the Lua environment
     * @returns {Promise<void>}
     * @throws {Error} If the Lua environment fails to initialize
     */
    async init() {
        try {
            this.lua = await this.factory.createEngine({
                openStandardLibs: true,
                injectObjects: true,
                functionTimeout: 1000,
            });

            for (const [name, value] of Object.entries(this.globals)) {
                this.lua.global.set(name, value);
            }
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to initialize LuaBridge: ' + errorMessage);
        }
    }


    /**
     * Closes the Lua environment
     * @throws {Error} If the Lua environment fails to close
     */
    close() {
        try {
            if (this.lua) {
                this.lua.global.close();
                this.lua = null;
            } else {
                throw new Error('LuaBridge not initialized');
            }
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to close LuaBridge: ' + errorMessage);
        }
    }


    /**
     * Sets a global variable in the Lua environment
     * @param {string} name - The name of the global variable
     * @param {any} value - The value of the global variable
     * @throws {Error} If the global variable cannot be set
     */
    setGlobal(name, value) {
        try {
            if (!this.lua) throw new Error('LuaBridge not initialized');
            this.globals[name] = value;
            this.lua.global.set(name, value);
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to set global: ' + errorMessage);
        }
    }


    /**
     * Gets a global variable from the Lua environment
     * @param {string} name - The name of the global variable
     * @returns {any} - The value of the global variable
     * @throws {Error} If the global variable cannot be retrieved
     */
    getGlobal(name) {
        try {
            if (!this.lua) throw new Error('LuaBridge not initialized');
            return this.lua.global.get(name);
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to get global: ' + errorMessage);
        }
    }


    /**
     * Set a field in a Lua table
     * @param {string} table - The name of the table
     * @param {string} field - The name of the field
     * @param {any} value - The value to set
     * @throws {Error} If the field cannot be set
    */
    setField(table, field, value) {
        try {
            if (!this.lua) throw new Error('LuaBridge not initialized');
            this.lua.global.getTable(table, (index) => {
                this.lua.global.setField(index, field, value);
            });
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to set field: ' + errorMessage);
        }
    }


    /**
     * Injects a script into package.loaded
     * @param {string} name - Name of the module
     * @param {string} code - Lua code to inject
     * @returns {Promise<void>}
     * @throws {Error} If the module fails to load
     */
    async loadModule(name, code) {
        if (!this.lua) throw new Error('LuaBridge not initialized');
        try {
            await this.lua.doString(`package.loaded['${name}'] = (function(...) ${code} end)()`);
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to load module: ' + errorMessage);
        }
    }


    /**
     * Executes Lua code in the environment
     * @param {string} code - The Lua code to execute
     * @param {...any} args - Arguments to pass to the Lua code
     * @returns {Promise<any>} - The result of the Lua code execution
     * @throws {Error} If the Lua code execution fails
     */
    async execute(code, ...args) {
        if (!this.lua) throw new Error('LuaBridge not initialized');
        try {
            if (args.length > 0) {
                this.lua.global.set('args', args);
                code = LuaWrap(code);
            }
            return await this.lua.doString(code);
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to execute code: ' + errorMessage);
        }
    }

    async executeFile(file, ...args) {
        if (!this.lua) throw new Error('LuaBridge not initialized');
        try {
            if (args.length > 0) {
                this.lua.global.set('args', args);
            }
            return await this.lua.doFile(file);
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to execute file: ' + errorMessage);
        }
    }

    /**
     * mount a file into the lua environment
     * @param {string} file - The path to the file in the lua environment
     * @param {string} content - The content of the file
     * @returns {Promise<void>}
     * @throws {Error} If the file cannot be mounted
     * @example
     * await lua.mountFile('hello/init.lua', 'print("Hello, World!")');
     * await lua.execute('require("hello/init")');
    */
    async mountFile(file, content) {
        if (!this.lua) throw new Error('LuaBridge not initialized');
        try {
            await this.factory.mountFile(file, content);
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            throw new Error('Failed to mount file: ' + errorMessage);
        }
    }
}

export default LuaBridge;

/**
 * Create a new LuaBridge instance
 * @returns {Promise<LuaBridge>} - LuaBridge instance
 */
export async function createLuaBridge() {
    const lua = new LuaBridge();
    await lua.init();
    return lua;
};

/**
 * Run Lua code in an isolated LuaBridge instance
 * @param {string} code - Lua code to run
 * @param {any[]} args - Arguments to pass to the Lua code
 * @returns {Promise<any>} - Result of the Lua code
 * @throws {Error} If the Lua code execution fails
 */
export async function runLuaCode(code, ...args) {
    const lua = await createLuaBridge();
    try {
        const result = await lua.execute(code, ...args);
        lua.close();
        return result;
    } catch (error) {
        lua.close();
        throw error;
    }
};