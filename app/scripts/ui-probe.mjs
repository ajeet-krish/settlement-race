import puppeteer from "puppeteer-core";
import { readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function findChrome() {
    const root = join(homedir(), ".cache", "puppeteer", "chrome");
    const found = [];
    const walk = (dir) => {
        for (const e of readdirSync(dir)) {
            const full = join(dir, e);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (e === "Google Chrome for Testing" && full.endsWith("/MacOS/Google Chrome for Testing")) found.push(full);
        }
    };
    walk(root);
    found.sort();
    return found.at(-1);
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("requestfailed", (r) => console.log("REQFAIL", r.url()));
page.on("response", (r) => { if (r.status() >= 400) console.log("HTTP", r.status(), r.url()); });
await page.setViewport({ width: 1440, height: 900 });
await page.goto("http://localhost:5199", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 800));
const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const se = document.scrollingElement;
    const out = { vw, scrollWidth: se.scrollWidth, clientWidth: se.clientWidth, htmlWidth: document.documentElement.clientWidth, bodyScrollWidth: document.body.scrollWidth, offenders: [] };
    for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0) continue;
        if (r.right > vw + 2) {
            out.offenders.push({
                tag: el.tagName.toLowerCase(),
                cls: typeof el.className === "string" ? el.className : "",
                left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
                position: cs.position, marginLeft: cs.marginLeft, paddingRight: cs.paddingRight,
                text: (el.textContent ?? "").trim().slice(0, 40),
            });
        }
    }
    // deep chain of the widest offender
    out.offenders = out.offenders.slice(0, 12);
    return out;
});
console.log(JSON.stringify(report, null, 1));
await browser.close();
