import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import {
    createRaceSource,
    nextScenarioIdBase,
    type RaceChainVerifyContext,
    type RaceSourceOptions,
} from "../raceSource";
import { MockProgramClient } from "../mockClient";
import {
    DEMO_ACCOUNTS_MISSING_GUIDANCE,
    DemoAccountsError,
    base58Encode,
    type DemoAccounts,
} from "../demoAccounts";
import { PROGRAM_ID, scenarioPda } from "../pda";
import { getScenario } from "../../engine/scenarios";
import type { RaceEvent } from "../../engine/scenarioEngine";
import type { InitScenarioArgs, ProgramClient } from "../programClient";

interface Harness {
    options: RaceSourceOptions;
    accounts: DemoAccounts;
    driver: Keypair;
    verify: ReturnType<typeof vi.fn>;
    ids: bigint[];
}

/** A structurally valid in-memory demo accounts file. */
function fixtureAccounts(): {
    accounts: DemoAccounts;
    driver: Keypair;
    partyA: Keypair;
    partyB: Keypair;
} {
    const partyA = Keypair.generate();
    const partyB = Keypair.generate();
    const driver = Keypair.generate();
    const entry = (keypair: Keypair) => ({
        secret: base58Encode(keypair.secretKey),
        pubkey: keypair.publicKey.toBase58(),
    });
    return {
        accounts: {
            version: 1,
            cluster: "devnet",
            program_id: PROGRAM_ID.toBase58(),
            partyA: entry(partyA),
            partyB: entry(partyB),
            driver: entry(driver),
            usd_mint: Keypair.generate().publicKey.toBase58(),
            cad_mint: Keypair.generate().publicKey.toBase58(),
            note: "test fixture",
        },
        driver,
        partyA,
        partyB,
    };
}

/** New MockProgramClient per run, recording every scenario id used. */
function recordingBuildClient(ids: bigint[]): () => ProgramClient {
    return () => {
        const client = new MockProgramClient();
        const init = client.initScenario.bind(client);
        client.initScenario = async (args: InitScenarioArgs) => {
            ids.push(args.scenario_id);
            return init(args);
        };
        return client;
    };
}

/**
 * Fully offline source: injected accounts loader, mock program client,
 * a connection stub whose probe reports every PDA free, and a verification
 * stub. No test in this file touches the network.
 */
function harness(overrides: Partial<RaceSourceOptions> = {}): Harness {
    const { accounts, driver } = fixtureAccounts();
    const ids: bigint[] = [];
    const verify = vi.fn(
        async (_ctx: RaceChainVerifyContext) => ({
            valid: true,
            on_chain_head: "00".repeat(32),
            local_head: "00".repeat(32),
            event_count_match: true,
        }),
    );
    const options: RaceSourceOptions = {
        connection: {
            getAccountInfo: vi.fn(
                async (_address: PublicKey, _commitment?: string) => null,
            ),
        } as unknown as Connection,
        loadAccounts: async () => accounts,
        buildClient: recordingBuildClient(ids),
        verifyChain: verify,
        ...overrides,
    };
    return { options, accounts, driver, verify, ids };
}

describe("createRaceSource", () => {
    it("returns the setup guidance when the accounts file is missing", async () => {
        const state = await createRaceSource({
            loadAccounts: async () => {
                throw new DemoAccountsError(
                    "missing",
                    DEMO_ACCOUNTS_MISSING_GUIDANCE,
                );
            },
        });

        expect(state.status).toBe("missing-accounts");
        if (state.status !== "missing-accounts") {
            throw new Error(`expected missing-accounts, got ${state.status}`);
        }
        expect(state.guidance).toContain(
            "Run npx tsx scripts/setup-devnet.ts first",
        );
    });

    it("surfaces a typed validation failure as an error state", async () => {
        const state = await createRaceSource({
            loadAccounts: async () => {
                throw new DemoAccountsError(
                    "bad_program_id",
                    "demo-accounts.json program_id does not match this app's program id.",
                );
            },
        });

        expect(state.status).toBe("error");
        if (state.status !== "error") {
            throw new Error(`expected error, got ${state.status}`);
        }
        expect(state.message).toContain("program_id");
    });

    it("maps an unexpected loader failure to a generic error without details", async () => {
        const state = await createRaceSource({
            loadAccounts: async () => {
                throw new TypeError("fetch failed: very secret payload");
            },
        });

        expect(state.status).toBe("error");
        if (state.status !== "error") {
            throw new Error(`expected error, got ${state.status}`);
        }
        expect(state.message).toBe("Demo accounts could not be loaded.");
        expect(state.message).not.toContain("secret");
    });

    it("runs the honest scenario end to end, wiring every event in order", async () => {
        const h = harness();
        const state = await createRaceSource(h.options);

        expect(state.status).toBe("ready");
        if (state.status !== "ready") {
            throw new Error(`expected ready, got ${state.status}`);
        }
        expect(state.accounts).toBe(h.accounts);
        expect(state.createClient()).toBeInstanceOf(MockProgramClient);

        const events: RaceEvent[] = [];
        const outcome = await state.runScenario(getScenario("honest"), (e) =>
            events.push(e),
        );

        expect(outcome.chain_ok).toBe(true);
        expect(outcome.error).toBeUndefined();
        expect(events.length).toBeGreaterThan(10);
        expect(events[0]?.event).toBe("TICKET_CREATED");
        expect(events.at(-1)?.event).toBe("CHAIN_ANCHORED");

        expect(h.verify).toHaveBeenCalledTimes(1);
        const ctx = h.verify.mock.calls[0]?.[0] as RaceChainVerifyContext;
        expect(ctx.chain.length).toBe(events.length);
        expect(ctx.chain.verify()).toBe(true);
        expect(ctx.scenario).toBeInstanceOf(PublicKey);
    });

    it("reports chain_ok false when verification runs and does not match", async () => {
        const h = harness({
            verifyChain: async () => ({
                valid: false,
                on_chain_head: null,
                local_head: "00".repeat(32),
                event_count_match: false,
            }),
        });
        const state = await createRaceSource(h.options);
        if (state.status !== "ready") {
            throw new Error(`expected ready, got ${state.status}`);
        }

        const outcome = await state.runScenario(getScenario("honest"));

        expect(outcome.chain_ok).toBe(false);
        expect(outcome.error).toBeUndefined();
    });

    it("returns chain_ok null with retry guidance when the anchor read is rate limited", async () => {
        const h = harness({
            verifyChain: async () => {
                throw new Error("429 too many requests");
            },
        });
        const state = await createRaceSource(h.options);
        if (state.status !== "ready") {
            throw new Error(`expected ready, got ${state.status}`);
        }

        const outcome = await state.runScenario(getScenario("honest"));

        expect(outcome.chain_ok).toBeNull();
        expect(outcome.error).toContain("rate limited");
        expect(outcome.error).toContain("run again");
    });

    it("maps engine failures to chain_ok null with typed guidance", async () => {
        const rateLimited = harness({
            buildClient: () => {
                const client = new MockProgramClient();
                client.initScenario = async () => ({
                    ok: false,
                    error: "RpcError: 429 too many requests",
                });
                return client;
            },
        });
        const limitedState = await createRaceSource(rateLimited.options);
        if (limitedState.status !== "ready") {
            throw new Error(`expected ready, got ${limitedState.status}`);
        }
        const limited = await limitedState.runScenario(getScenario("honest"));
        expect(limited.chain_ok).toBeNull();
        expect(limited.error).toContain("rate limited");

        const rejected = harness({
            buildClient: () => {
                const client = new MockProgramClient();
                client.initScenario = async () => ({
                    ok: false,
                    error: "BadState: clock already advanced",
                });
                return client;
            },
        });
        const rejectedState = await createRaceSource(rejected.options);
        if (rejectedState.status !== "ready") {
            throw new Error(`expected ready, got ${rejectedState.status}`);
        }
        const failed = await rejectedState.runScenario(getScenario("honest"));
        expect(failed.chain_ok).toBeNull();
        expect(failed.error).toContain("Run failed");
        expect(failed.error).toContain("BadState");
    });

    it("hands out a fresh scenario id base for every run", async () => {
        const h = harness();
        const state = await createRaceSource(h.options);
        if (state.status !== "ready") {
            throw new Error(`expected ready, got ${state.status}`);
        }

        const first = await state.runScenario(getScenario("honest"));
        const second = await state.runScenario(getScenario("honest"));

        expect(first.chain_ok).toBe(true);
        expect(second.chain_ok).toBe(true);
        expect(h.ids).toHaveLength(4);
        expect(h.ids[1]).toBe((h.ids[0] ?? 0n) + 1n);
        expect(h.ids[3]).toBe((h.ids[2] ?? 0n) + 1n);
        expect(h.ids[2]).toBeDefined();
        expect((h.ids[2] ?? 0n) > (h.ids[0] ?? 0n)).toBe(true);
    });

    it("never overlaps lane ids across two consecutive runs when the probe reports every PDA free", async () => {
        const probe = vi.fn(async (_address: PublicKey, _c?: string) => null);
        const h = harness({
            connection: {
                getAccountInfo: probe,
            } as unknown as Connection,
        });
        const state = await createRaceSource(h.options);
        if (state.status !== "ready") {
            throw new Error(`expected ready, got ${state.status}`);
        }

        const first = await state.runScenario(getScenario("honest"));
        const second = await state.runScenario(getScenario("honest"));

        expect(first.chain_ok).toBe(true);
        expect(second.chain_ok).toBe(true);

        // Two runs, two lanes each: [s1, a1, s2, a2].
        expect(h.ids).toHaveLength(4);
        const [s1, a1, s2, a2] = h.ids as [bigint, bigint, bigint, bigint];
        expect(a1).toBe(s1 + 1n);
        expect(a2).toBe(s2 + 1n);
        // Run 2 starts strictly above run 1's atomic id: no collision.
        expect(s2 > a1).toBe(true);

        // The probe was consulted for both lane PDAs of both runs and
        // reported every candidate free, so no stepping occurred.
        expect(probe.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it("steps the base past a PDA that already exists on chain", async () => {
        let probes = 0;
        const occupiedOnce = vi.fn(
            async (_address: PublicKey, _commitment?: string) => {
                probes += 1;
                return probes === 1 ? {} : null;
            },
        );
        const h = harness({
            connection: {
                getAccountInfo: occupiedOnce,
            } as unknown as Connection,
        });
        const state = await createRaceSource(h.options);
        if (state.status !== "ready") {
            throw new Error(`expected ready, got ${state.status}`);
        }

        const outcome = await state.runScenario(getScenario("honest"));

        expect(outcome.chain_ok).toBe(true);
        const usedId = h.ids[0];
        expect(usedId).toBeDefined();
        expect((usedId ?? 0n) % 2n).toBe(1n);
        const firstProbe = occupiedOnce.mock.calls[0]?.[0] as PublicKey;
        const firstCandidate = scenarioPda(
            h.driver.publicKey,
            (usedId ?? 0n) - 2n,
        )[0];
        expect(firstCandidate.equals(firstProbe)).toBe(true);
        expect(occupiedOnce.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
});

describe("nextScenarioIdBase", () => {
    it("stays odd, respects the formula floor, and bumps by two on a repeat", () => {
        const nowMs = 123_456;
        const first = nextScenarioIdBase(nowMs);
        const floor = (BigInt(nowMs) % 1_000_000n) * 2n + 1n;

        expect(first % 2n).toBe(1n);
        expect(first >= floor).toBe(true);

        const second = nextScenarioIdBase(nowMs);
        expect(second).toBe(first + 2n);
        expect(second % 2n).toBe(1n);
    });
});
