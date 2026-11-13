#!/usr/bin/env node
/*
 * UI audit: responsiveness and runtime errors across viewports and tabs.
 *
 * Assumes a dev server is already running (default http://localhost:5199).
 * For each viewport it loads the app, switches to offline mode, runs the
 * Default after leg 1 scenario, then visits all four tabs WITHOUT reloading,
 * checking:
 *   1. no horizontal page overflow (scrollWidth fits clientWidth)
 *   2. no visible element pokes past the right edge of the viewport
 *   3. zero console errors and page errors
 *
 * Usage:
 *   node scripts/ui-audit.mjs [baseUrl]
 *   npm run audit:ui
 *
 * Exit code is non-zero if any check fails, so it can gate a commit.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE_URL = process.argv[2] ?? "http://localhost:5199";
const VIEWPORTS = [
    { name: "375", width: 375, height: 812 },
    { name: "768", width: 768, height: 1024 },
    { name: "1024", width: 1024, height: 768 },
    { name: "1440", width: 1440, height: 900 },
];
const TABS = [
    { id: "race", label: "Race" },
    { id: "tickets", label: "Tickets" },
    { id: "provenance", label: "Provenance" },
    { id: "learn", label: "Learn" },
];
const EDGE_TOLERANCE_PX = 2;

function findChromeBinary() {
    const root = join(homedir(), ".cache", "puppeteer", "chrome");
    if (!existsSync(root)) {
        throw new Error(`No puppeteer cache at ${root}; cannot run the UI audit.`);
    }
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
                continue;
            }
            if (entry === "Google Chrome for Testing" && full.endsWith("/MacOS/Google Chrome for Testing")) {
                found.push(full);
            }
        }
    };
    walk(root);
    if (found.length === 0) {
        throw new Error(`No Chrome for Testing binary under ${root}.`);
    }
    found.sort();
    return found[found.length - 1];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickText(page, selector, text, { exact = true } = {}) {
    const found = await page.evaluate(
        (sel, label, useExact) => {
            const nodes = [...document.querySelectorAll(sel)];
            const match = useExact
                ? (node) => node.textContent?.trim() === label
                : (node) => (node.textContent ?? "").includes(label);
            const node = nodes.find(match);
            if (node === undefined) {
                return false;
            }
            node.scrollIntoView({ block: "center" });
            node.click();
            return true;
        },
        selector,
        text,
        exact,
    );
    if (!found) {
        throw new Error(`No ${selector} with text "${text}"`);
    }
}

async function runScenarioOffline(page) {
    // Switch to the offline demo mode.
    await clickText(page, '[aria-label="Settlement source"] button', "Offline demo");
    await sleep(400);
    // Pick the Default after leg 1 scenario card.
    await clickText(page, ".picker-card", "Default after leg 1", { exact: false });
    await sleep(200);
    // Start the run and wait for the terminal chain verdict.
    await clickText(page, "button", "Run scenario");
    await page.waitForFunction(
        () => {
            const body = document.body.textContent ?? "";
            return /chain (valid|broken)/i.test(body);
        },
        { timeout: 60_000 },
    );
    await sleep(600);
}

async function main() {
    const executablePath = findChromeBinary();
    const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    let failures = 0;
    try {
        for (const viewport of VIEWPORTS) {
            await page.setViewport({ width: viewport.width, height: viewport.height });
            await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 60_000 });
            await sleep(600);
            await runScenarioOffline(page);

            for (const tab of TABS) {
                await clickText(page, '.tablist [role="tab"]', tab.label);
                await sleep(400);
                const measure = await page.evaluate((tolerance) => {
                    const doc = document.scrollingElement;
                    const overflow = doc.scrollWidth - doc.clientWidth;
                    const offenders = [];
                    for (const element of document.querySelectorAll("body *")) {
                        const rect = element.getBoundingClientRect();
                        const style = getComputedStyle(element);
                        if (
                            style.visibility === "hidden" ||
                            style.display === "none" ||
                            rect.width === 0
                        ) {
                            continue;
                        }
                        if (rect.right > window.innerWidth + tolerance) {
                            offenders.push({
                                tag: element.tagName.toLowerCase(),
                                className: typeof element.className === "string" ? element.className : "",
                                right: Math.round(rect.right),
                                text: (element.textContent ?? "").trim().slice(0, 60),
                            });
                        }
                    }
                    return { overflow, offenders: offenders.slice(0, 8) };
                }, EDGE_TOLERANCE_PX);

                const ok =
                    measure.overflow <= EDGE_TOLERANCE_PX && measure.offenders.length === 0;
                if (!ok) {
                    failures += 1;
                }
                console.log(
                    `${ok ? "PASS" : "FAIL"}  ${viewport.name.padEnd(5)} ${tab.label.padEnd(12)} overflow=${measure.overflow}px offenders=${measure.offenders.length}`,
                );
                for (const offender of measure.offenders) {
                    console.log(
                        `     offends: <${offender.tag} class="${offender.className}"> right=${offender.right} text="${offender.text}"`,
                    );
                }
            }
        }

        if (consoleErrors.length > 0 || pageErrors.length > 0) {
            failures += 1;
            console.log(`FAIL  console errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
            for (const line of [...consoleErrors, ...pageErrors].slice(0, 10)) {
                console.log(`     ${line}`);
            }
        } else {
            console.log("PASS  console clean (zero errors across all viewports and tabs)");
        }
    } finally {
        await browser.close();
    }

    if (failures > 0) {
        console.log(`\nUI AUDIT FAILED (${failures} failure groups)`);
        process.exit(1);
    }
    console.log("\nUI AUDIT PASSED: no overflow, no cutoff, console clean");
}

main().catch((error) => {
    console.error(`UI AUDIT ERROR: ${error.message}`);
    process.exit(2);
});
