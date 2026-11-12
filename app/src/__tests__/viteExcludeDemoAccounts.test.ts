import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "vite";
import userConfig from "../../vite.config";

/**
 * Unit coverage for the excludeDemoAccounts build guard. The plugin
 * function is not exported, so the test reaches it through the config's
 * plugins array (the same object vite build executes) and drives its
 * closeBundle hook directly.
 *
 * Safety: no test ever touches the real app/dist tree. Every case points
 * the plugin at a fresh mkdtemp root through the configResolved outDir
 * seam (the same mechanism a `vite build --outDir X` override uses), then
 * plants and removes only files inside that temp root, which is removed
 * with force in the test's finally block. The hook only unlinks
 * <outDir>/demo-accounts.json, so each case asserts the planted file is
 * gone while its sibling survives, byte for byte. afterEach points the
 * shared plugin instance back at the default outDir and restores spies
 * so a custom-root test cannot leak its config into the next test.
 */

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The config-shaped input the plugin reads in configResolved. */
type ResolvedConfigStub = { root: string; build: { outDir: string } };

/** The registered exclude-demo-accounts plugin instance. */
function findPlugin(): Plugin {
    const plugins = ((userConfig as { plugins?: unknown[] }).plugins ?? []).filter(
        (p): p is Plugin => p !== null && p !== undefined && typeof p === "object",
    );
    const found = plugins.find((p) => p.name === "exclude-demo-accounts");
    if (found === undefined) {
        throw new Error("exclude-demo-accounts plugin not registered");
    }
    return found;
}

/** The plugin's closeBundle hook as a plain callable function. */
function closeBundleHook(): () => void | Promise<void> {
    const hook = findPlugin().closeBundle;
    if (typeof hook !== "function") {
        throw new Error("closeBundle is not a plain function");
    }
    return hook as () => void | Promise<void>;
}

/**
 * The plugin's configResolved hook, narrowed to the stub shape the guard
 * actually reads (root and build.outDir). Vite passes a full ResolvedConfig;
 * the plugin never touches anything else, so a stub is enough here.
 */
function configResolvedHook(): (config: ResolvedConfigStub) => void {
    const hook = findPlugin().configResolved;
    if (typeof hook !== "function") {
        throw new Error("configResolved is not a plain function");
    }
    return hook as unknown as (config: ResolvedConfigStub) => void;
}

/** Point the plugin back at the default app/dist output for the next test. */
function resetToDefaultOutDir(): void {
    configResolvedHook()({ root: appRoot, build: { outDir: "dist" } });
}

/** Entries of a directory, sorted, or null when it does not exist. */
function dirEntries(dir: string): string[] | null {
    return existsSync(dir) ? readdirSync(dir).sort() : null;
}

/**
 * A fresh mkdtemp root with a `dist` stand-in for the build output,
 * seeded with the sibling files a real build leaves behind plus the
 * guarded demo-accounts.json. The plugin is pointed at this root with
 * root and the relative outDir, exactly as vite would after a real
 * configResolved call.
 */
function plantTempDist(): { tmpRoot: string; outDir: string; planted: string } {
    const tmpRoot = mkdtempSync(join(tmpdir(), "settlement-race-dist-"));
    const outDir = join(tmpRoot, "dist");
    mkdirSync(join(outDir, "assets"), { recursive: true });
    writeFileSync(join(outDir, "index.html"), "<html></html>");
    writeFileSync(join(outDir, "assets", "app.js"), "// bundle");
    const planted = join(outDir, "demo-accounts.json");
    writeFileSync(planted, '{"planted":"by the test"}');
    configResolvedHook()({ root: tmpRoot, build: { outDir: "dist" } });
    return { tmpRoot, outDir, planted };
}

beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    // Point the shared plugin instance back at the default outDir so a
    // temp-root test cannot leak its config into the next test.
    resetToDefaultOutDir();
    vi.restoreAllMocks();
});

describe("vite.config excludeDemoAccounts", () => {
    it("is registered and applied to build only", () => {
        const plugin = findPlugin();
        expect(plugin.name).toBe("exclude-demo-accounts");
        expect(plugin.apply).toBe("build");
        expect(typeof plugin.closeBundle).toBe("function");
    });

    it("removes a planted dist/demo-accounts.json and warns, leaving other dist entries untouched", async () => {
        const { tmpRoot, outDir, planted } = plantTempDist();
        try {
            const before = dirEntries(outDir) ?? [];
            expect(before).toContain("demo-accounts.json");
            expect(before).toContain("index.html");

            await closeBundleHook()();

            expect(existsSync(planted)).toBe(false);
            expect(dirEntries(outDir)).toEqual(
                before.filter((entry) => entry !== "demo-accounts.json"),
            );
            expect(existsSync(join(outDir, "index.html"))).toBe(true);
            expect(existsSync(join(outDir, "assets", "app.js"))).toBe(true);
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining("demo-accounts.json excluded from dist"),
            );
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining("devnet demo keys"),
            );
        } finally {
            rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it("still emits the exclusion warning when the file is absent", async () => {
        const tmpRoot = mkdtempSync(join(tmpdir(), "settlement-race-dist-"));
        try {
            const outDir = join(tmpRoot, "dist");
            mkdirSync(outDir, { recursive: true });
            writeFileSync(join(outDir, "index.html"), "<html></html>");
            configResolvedHook()({ root: tmpRoot, build: { outDir: "dist" } });
            const before = dirEntries(outDir);

            await closeBundleHook()();

            expect(existsSync(join(outDir, "demo-accounts.json"))).toBe(false);
            expect(dirEntries(outDir)).toEqual(before);
            expect(console.warn).toHaveBeenCalledTimes(1);
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining("demo-accounts.json excluded from dist"),
            );
        } finally {
            rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it("removes demo-accounts.json from a custom outDir resolved against the project root", async () => {
        const tmpRoot = mkdtempSync(join(tmpdir(), "settlement-race-outdir-"));
        try {
            const customOut = join(tmpRoot, "custom-out");
            mkdirSync(customOut, { recursive: true });
            const customPlanted = join(customOut, "demo-accounts.json");
            const customSibling = join(customOut, "index.html");
            writeFileSync(customPlanted, '{"planted":"by the test"}');
            writeFileSync(customSibling, "<html></html>");

            // A second outDir under the same root standing in for the
            // default dist: with a custom outDir configured the guard
            // must target only the configured output directory.
            const defaultOut = join(tmpRoot, "dist");
            mkdirSync(defaultOut, { recursive: true });
            const defaultPlanted = join(defaultOut, "demo-accounts.json");
            writeFileSync(defaultPlanted, '{"planted":"by the test"}');

            // Relative outDir, as vite resolves it against config.root.
            configResolvedHook()({ root: tmpRoot, build: { outDir: "custom-out" } });
            await closeBundleHook()();

            expect(existsSync(customPlanted)).toBe(false);
            expect(existsSync(customSibling)).toBe(true);
            expect(existsSync(defaultPlanted)).toBe(true);
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining("demo-accounts.json excluded from dist"),
            );
        } finally {
            rmSync(tmpRoot, { recursive: true, force: true });
        }
    });
});
