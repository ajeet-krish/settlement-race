import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "vite";
import userConfig from "../../vite.config";

/**
 * Unit coverage for the excludeDemoAccounts build guard. The plugin
 * function is not exported, so the test reaches it through the config's
 * plugins array (the same object vite build executes) and drives its
 * closeBundle hook directly against app/dist.
 *
 * Safety: the hook only unlinks dist/demo-accounts.json, so the test
 * plants that one path, asserts every other dist entry survives, and
 * restores the pre-test state of that path in afterEach. It never deletes
 * assets, index.html, or any other build output, and vitest never runs
 * concurrently with a build, so a real dist cannot be nuked mid-build.
 */

const distDir = fileURLToPath(new URL("../../dist/", import.meta.url));
const plantedPath = fileURLToPath(
    new URL("../../dist/demo-accounts.json", import.meta.url),
);

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

/** Current dist entries, or null when the directory does not exist. */
function distEntries(): string[] | null {
    return existsSync(distDir) ? readdirSync(distDir).sort() : null;
}

/** Pre-test contents of the guarded path, restored in afterEach. */
let backup: string | null = null;

beforeEach(() => {
    backup = existsSync(plantedPath) ? readFileSync(plantedPath, "utf8") : null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    if (backup !== null) {
        writeFileSync(plantedPath, backup);
    } else if (existsSync(plantedPath)) {
        rmSync(plantedPath);
    }
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
        mkdirSync(distDir, { recursive: true });
        const before = distEntries() ?? [];
        expect(before).not.toContain("demo-accounts.json");
        writeFileSync(plantedPath, '{"planted":"by the test"}');

        await closeBundleHook()();

        expect(existsSync(plantedPath)).toBe(false);
        expect(distEntries()).toEqual(before);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining("demo-accounts.json excluded from dist"),
        );
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining("devnet demo keys"),
        );
    });

    it("still emits the exclusion warning when the file is absent", async () => {
        const before = distEntries();

        await closeBundleHook()();

        expect(existsSync(plantedPath)).toBe(false);
        expect(distEntries()).toEqual(before);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining("demo-accounts.json excluded from dist"),
        );
    });
});
