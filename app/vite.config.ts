import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Directory holding this config file (the default build root). */
const app_root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Keep app/public/demo-accounts.json out of every build output. Vite copies
 * publicDir verbatim (at renderStart, before the bundle is written), and
 * that file holds the three devnet demo private keys, so a shipped dist must
 * never contain it. The dev server still serves it from source, which is how
 * the app gets the keys: run npx tsx scripts/setup-devnet.ts first, then
 * npm run dev. The warning is printed on every build so a reviewer can see
 * the exclusion policy even when the file is absent.
 *
 * The removal target is read from the resolved build.outDir (captured in
 * configResolved), so a `vite build --outDir X` override is guarded too and
 * the keys cannot ship from a custom output directory.
 */
function excludeDemoAccounts(): Plugin {
    // Absolute output directory from the resolved config. Vite always calls
    // configResolved before closeBundle on a real build; the null fallback
    // below only covers direct hook invocation (unit tests) and resolves to
    // the default output directory next to this file.
    let out_dir: string | null = null;
    return {
        name: "exclude-demo-accounts",
        // Build only: the dev server must keep serving the file from source,
        // and vitest must not emit the build warning.
        apply: "build",
        configResolved(config) {
            out_dir = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
            // Interrupted builds are suspect: a partial bundle may still hold keys, and emptyOutDir wipes the directory on the next build.
            const target = resolve(
                out_dir ?? resolve(app_root, "dist"),
                "demo-accounts.json",
            );
            if (existsSync(target)) {
                rmSync(target);
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
