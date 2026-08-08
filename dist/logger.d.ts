/**
 * Toggles the `debug` channel, which is off by default so an integration does not narrate every
 * event into a host application's console. `init({ debug: true })` turns it on; `destroy()` resets
 * it. `warn` and `error` are never gated — they report things an integrator needs to see regardless.
 */
export declare const setDebugLogging: (enabled: boolean) => void;
export declare const log: {
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
    debug: (msg: string, ...args: unknown[]) => void;
};
