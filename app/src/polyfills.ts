// Browser polyfill for the Node builtins required by the Solana client stack
// (@solana/web3.js 1.x and @solana/spl-token read Buffer, and some transitive
// deps read global and process, at module init time). Vite does not polyfill
// Node builtins for the browser, so without this file the dev server crashes
// with "ReferenceError: Buffer is not defined". Vitest and the production
// build never execute the browser path, which is why tests and builds pass.
//
// This MUST be the first import in main.tsx so it evaluates before the
// Solana import chain.

import { Buffer } from "buffer";

// Narrow cast so the shim types do not depend on @types/node being present.
type NodeGlobals = {
    Buffer?: typeof Buffer;
    global?: unknown;
    process?: { env?: Record<string, string | undefined> };
};

const g = globalThis as unknown as NodeGlobals;

// Only fill in what is missing: never clobber a real Buffer (tests run in
// Node), a real global, or a real process (vite replaces process.env.NODE_ENV
// statically; the {} env covers stray runtime reads).
g.Buffer ??= Buffer;
g.global ??= globalThis;
g.process ??= { env: {} };
