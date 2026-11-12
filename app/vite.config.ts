import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Keep app/public/demo-accounts.json out of every build output. Vite copies
 * publicDir verbatim (at renderStart, before the bundle is written), and
 * that file holds the three devnet demo private keys, so a shipped dist must
 * never contain it. The dev server still serves it from source, which is how
 * the app gets the keys: run npx tsx scripts/setup-devnet.ts first, then
 * npm run dev. The warning is printed on every build so a reviewer can see
 * the exclusion policy even when the file is absent.
 */
function excludeDemoAccounts(): Plugin {
    return {
        name: "exclude-demo-accounts",
        // Build only: the dev server must keep serving the file from source,
        // and vitest must not emit the build warning.
        apply: "build",
        closeBundle() {
            const dist_file = fileURLToPath(
                new URL("./dist/demo-accounts.json", import.meta.url),
            );
            if (existsSync(dist_file)) {
                rmSync(dist_file);
            }
            console.warn(
                "demo-accounts.json excluded from dist (contains devnet demo keys); run the app with npm run dev after npx tsx scripts/setup-devnet.ts",
            );
        },
    };
}

export default defineConfig({
    plugins: [react(), excludeDemoAccounts()],
    // The app fetches same-origin only (/demo-accounts.json at the app
    // origin), so CORS is unnecessary. Vite's default allows any origin,
    // which would let any page open in a browser on this machine read the
    // devnet demo keys cross-origin while npm run dev runs.
    server: {
        cors: false,
    },
    test: {
        environment: "node",
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
});
