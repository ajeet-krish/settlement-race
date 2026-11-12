import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
    DEMO_ACCOUNTS_MISSING_GUIDANCE,
    DemoAccountsError,
    base58Decode,
    base58Encode,
    demoKeypair,
    fetchDemoAccounts,
    parseDemoAccounts,
} from "../demoAccounts";
import { PROGRAM_ID } from "../pda";

interface Fixture {
    /** The raw JSON object exactly as app/public/demo-accounts.json holds it. */
    raw: Record<string, unknown>;
    partyA: Keypair;
    partyB: Keypair;
    driver: Keypair;
}

/** A structurally valid demo accounts file with freshly generated keypairs. */
function fixture(): Fixture {
    const partyA = Keypair.generate();
    const partyB = Keypair.generate();
    const driver = Keypair.generate();
    return {
        partyA,
        partyB,
        driver,
        raw: {
            version: 1,
            cluster: "devnet",
            program_id: PROGRAM_ID.toBase58(),
            partyA: {
                secret: base58Encode(partyA.secretKey),
                pubkey: partyA.publicKey.toBase58(),
            },
            partyB: {
                secret: base58Encode(partyB.secretKey),
                pubkey: partyB.publicKey.toBase58(),
            },
            driver: {
                secret: base58Encode(driver.secretKey),
                pubkey: driver.publicKey.toBase58(),
            },
            usd_mint: Keypair.generate().publicKey.toBase58(),
            cad_mint: Keypair.generate().publicKey.toBase58(),
            note: "devnet play money only; gitignored; regenerate with npx tsx scripts/setup-devnet.ts",
        },
    };
}

function entryOf(
    raw: Record<string, unknown>,
    key: string,
): { secret: string; pubkey: string } {
    return raw[key] as { secret: string; pubkey: string };
}

/** Every secret in the fixture, for "message leaks nothing" assertions. */
function secretsOf(raw: Record<string, unknown>): string[] {
    return ["partyA", "partyB", "driver"].map((key) => entryOf(raw, key).secret);
}

/** Run a loader and return the DemoAccountsError it threw, or fail the test. */
async function captureError(run: () => unknown): Promise<DemoAccountsError> {
    try {
        await run();
    } catch (error) {
        if (error instanceof DemoAccountsError) {
            return error;
        }
        throw error;
    }
    throw new Error("expected the call to throw a DemoAccountsError");
}

describe("parseDemoAccounts", () => {
    it("accepts a well formed file and round trips every keypair", () => {
        const { raw, partyA, partyB, driver } = fixture();

        const accounts = parseDemoAccounts(raw);

        expect(accounts.version).toBe(1);
        expect(accounts.cluster).toBe("devnet");
        expect(accounts.program_id).toBe(PROGRAM_ID.toBase58());
        expect(accounts.partyA.pubkey).toBe(partyA.publicKey.toBase58());
        expect(accounts.partyB.pubkey).toBe(partyB.publicKey.toBase58());
        expect(accounts.driver.pubkey).toBe(driver.publicKey.toBase58());
        expect(accounts.usd_mint).toBe(raw.usd_mint);
        expect(accounts.cad_mint).toBe(raw.cad_mint);
        expect(accounts.note).toBe(raw.note);
        expect(demoKeypair(accounts.partyA).publicKey.toBase58()).toBe(
            partyA.publicKey.toBase58(),
        );
        expect(demoKeypair(accounts.partyB).publicKey.toBase58()).toBe(
            partyB.publicKey.toBase58(),
        );
        expect(demoKeypair(accounts.driver).publicKey.toBase58()).toBe(
            driver.publicKey.toBase58(),
        );
    });

    it("accepts 64 byte number array secrets and normalizes them to base58", () => {
        const { raw } = fixture();
        const keypair = Keypair.generate();
        raw.partyA = {
            secret: Array.from(keypair.secretKey),
            pubkey: keypair.publicKey.toBase58(),
        };

        const accounts = parseDemoAccounts(raw);

        expect(typeof accounts.partyA.secret).toBe("string");
        expect(accounts.partyA.pubkey).toBe(keypair.publicKey.toBase58());
        expect(demoKeypair(accounts.partyA).publicKey.toBase58()).toBe(
            keypair.publicKey.toBase58(),
        );
    });

    it("rejects a short secret with a specific error and no secret content", async () => {
        const { raw, partyA } = fixture();
        const shortSecret = base58Encode(partyA.secretKey.slice(0, 32));
        raw.partyA = {
            secret: shortSecret,
            pubkey: partyA.publicKey.toBase58(),
        };

        const error = await captureError(() => parseDemoAccounts(raw));

        expect(error.code).toBe("bad_secret");
        expect(error.message).toContain("partyA");
        expect(error.message).toContain("64");
        expect(error.message).not.toContain(shortSecret);
        for (const secret of secretsOf(raw)) {
            expect(error.message).not.toContain(secret);
        }
    });

    it("rejects a program id that does not match the app program", async () => {
        const { raw } = fixture();
        raw.program_id = Keypair.generate().publicKey.toBase58();

        const error = await captureError(() => parseDemoAccounts(raw));

        expect(error.code).toBe("bad_program_id");
        expect(error.message).toContain("program_id");
        for (const secret of secretsOf(raw)) {
            expect(error.message).not.toContain(secret);
        }
    });

    it("rejects an invalid mint address without leaking secrets", async () => {
        const { raw } = fixture();
        raw.usd_mint = "not-a-mint-address";

        const error = await captureError(() => parseDemoAccounts(raw));

        expect(error.code).toBe("bad_mint");
        expect(error.message).toContain("usd_mint");
        for (const secret of secretsOf(raw)) {
            expect(error.message).not.toContain(secret);
        }
    });

    it("rejects a missing driver entry without leaking secrets", async () => {
        const { raw } = fixture();
        const secrets = secretsOf(raw);
        delete raw.driver;

        const error = await captureError(() => parseDemoAccounts(raw));

        expect(error.code).toBe("bad_keypair");
        expect(error.message).toContain("driver");
        for (const secret of secrets) {
            expect(error.message).not.toContain(secret);
        }
    });

    it("rejects a secret whose public key does not match the declared one", async () => {
        const { raw, partyA } = fixture();
        const secrets = secretsOf(raw);
        const impostor = Keypair.generate();
        raw.partyA = {
            secret: base58Encode(partyA.secretKey),
            pubkey: impostor.publicKey.toBase58(),
        };

        const error = await captureError(() => parseDemoAccounts(raw));

        expect(error.code).toBe("bad_pubkey");
        expect(error.message).toContain("partyA");
        // Both public keys are named: the declared one and the derived one.
        expect(error.message).toContain(impostor.publicKey.toBase58());
        expect(error.message).toContain(partyA.publicKey.toBase58());
        for (const secret of secrets) {
            expect(error.message).not.toContain(secret);
        }
        expect(error.message).not.toContain(entryOf(raw, "partyA").secret);
    });

    it("rejects a number array secret paired with the wrong pubkey", async () => {
        const { raw, driver } = fixture();
        const secrets = secretsOf(raw);
        const impostor = Keypair.generate();
        raw.driver = {
            secret: Array.from(driver.secretKey),
            pubkey: impostor.publicKey.toBase58(),
        };

        const error = await captureError(() => parseDemoAccounts(raw));

        expect(error.code).toBe("bad_pubkey");
        expect(error.message).toContain("driver");
        for (const secret of secrets) {
            expect(error.message).not.toContain(secret);
        }
    });

    it("accepts a valid pair whose pubkey matches the secret", () => {
        const { raw, partyB } = fixture();

        const accounts = parseDemoAccounts(raw);

        const rebuilt = demoKeypair(accounts.partyB);
        expect(rebuilt.publicKey.toBase58()).toBe(accounts.partyB.pubkey);
        expect(rebuilt.publicKey.toBase58()).toBe(partyB.publicKey.toBase58());
    });
});

describe("fetchDemoAccounts", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns validated accounts from a successful response", async () => {
        const { raw } = fixture();
        const fetchMock = vi.fn(async (_url: string | URL | Request) =>
            new Response(JSON.stringify(raw), { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const accounts = await fetchDemoAccounts();

        expect(accounts.program_id).toBe(PROGRAM_ID.toBase58());
        expect(accounts.partyA.pubkey).toBe(entryOf(raw, "partyA").pubkey);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe("/demo-accounts.json");
    });

    it("joins a base url without duplicating slashes", async () => {
        const { raw } = fixture();
        const fetchMock = vi.fn(async (_url: string | URL | Request) =>
            new Response(JSON.stringify(raw), { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await fetchDemoAccounts("http://localhost:5173/");

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            "http://localhost:5173/demo-accounts.json",
        );
    });

    it("surfaces the setup guidance when the file is missing", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string | URL | Request) =>
                new Response(null, { status: 404 }),
            ),
        );

        const error = await captureError(() => fetchDemoAccounts());

        expect(error.code).toBe("missing");
        expect(error.message).toBe(DEMO_ACCOUNTS_MISSING_GUIDANCE);
    });

    it("pins the exact missing file guidance the UI surfaces", () => {
        expect(DEMO_ACCOUNTS_MISSING_GUIDANCE).toBe(
            "Demo accounts not found. Run npx tsx scripts/setup-devnet.ts first.",
        );
    });

    it("reports a transport failure with a typed error", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("Failed to fetch");
            }),
        );

        const error = await captureError(() => fetchDemoAccounts());

        expect(error.code).toBe("fetch_failed");
        expect(error.message).not.toContain("Failed to fetch");
    });

    it("rejects a response body that is not JSON", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string | URL | Request) =>
                new Response("<html>nope</html>", { status: 200 }),
            ),
        );

        const error = await captureError(() => fetchDemoAccounts());

        expect(error.code).toBe("bad_json");
    });
});

describe("base58 round trip", () => {
    it("encodes and decodes a keypair secret back to the same bytes", () => {
        const keypair = Keypair.generate();

        const encoded = base58Encode(keypair.secretKey);
        const decoded = base58Decode(encoded);

        expect(decoded).not.toBeNull();
        expect(Array.from(decoded ?? [])).toEqual(Array.from(keypair.secretKey));
        expect(encoded).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    });

    it("rejects characters outside the base58 alphabet", () => {
        expect(base58Decode("not0OIl")).toBeNull();
        expect(base58Decode("")).toBeNull();
    });
});
