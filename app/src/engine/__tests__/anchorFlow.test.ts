import { describe, expect, it, vi } from "vitest";
import { BN, BorshAccountsCoder } from "@anchor-lang/core";
import type { Idl } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { AccountInfo, Connection } from "@solana/web3.js";
import {
    anchorTerminalChain,
    headToBytes,
    verifyAgainstChainHead,
} from "../anchorFlow";
import { MockProgramClient, programErrorCode } from "../../lib/mockClient";
import { PROGRAM_ID, scenarioPda } from "../../lib/pda";
import { GENESIS_HASH, ProvenanceChain, type ProvenanceInput } from "../../lib/provenance";
import idlJson from "../../lib/settlement_race.json";
import type { TxResult } from "../../lib/programClient";

const TICKET_HASH = new Uint8Array(32).fill(9);
const T_START_MS = 1000n;

function expectOk(result: TxResult): string {
    if (!result.ok) {
        throw new Error(`expected success, got: ${result.error}`);
    }
    return result.signature;
}

/** Minimal lane opener: init through start so the scenario can go terminal. */
async function openLane(
    client: MockProgramClient,
    driver: PublicKey,
    partyA: PublicKey,
    partyB: PublicKey,
    scenarioId: bigint,
): Promise<PublicKey> {
    const [scenario] = scenarioPda(driver, scenarioId);
    expectOk(
        await client.initScenario({
            driver,
            party_a: partyA,
            party_b: partyB,
            scenario_id: scenarioId,
            ticket_hash: TICKET_HASH,
            path: "SEQUENTIAL",
            leg1_usd_cents: 100_000n,
            leg2_cad_cents: 130_000n,
            gap_ms: 5_000n,
        }),
    );
    expectOk(
        await client.advanceClock({ scenario, signer: driver, to_ms: T_START_MS }),
    );
    expectOk(await client.ack({ scenario, signer: partyA }));
    expectOk(await client.ack({ scenario, signer: partyB }));
    expectOk(
        await client.fundLeg({
            scenario,
            signer: partyA,
            leg: "LEG1_USD",
            amount_cents: 100_000n,
        }),
    );
    expectOk(
        await client.fundLeg({
            scenario,
            signer: partyB,
            leg: "LEG2_CAD",
            amount_cents: 130_000n,
        }),
    );
    expectOk(await client.startRace({ scenario, signer: driver }));
    return scenario;
}

/** Four record chain covering ticket, ack, funding, and settlement. */
function sampleInputs(scenarioId: string): ProvenanceInput[] {
    return [
        {
            schema_version: 1,
            seq: 0,
            scenario_id: scenarioId,
            event: "TICKET_CREATED",
            actor: "ENGINE",
            virtual_ts_ms: "0",
            real_ts_iso: "2026-11-11T09:00:00.000Z",
            data: { ticket_id: scenarioId },
            tx_sig: null,
        },
        {
            schema_version: 1,
            seq: 1,
            scenario_id: scenarioId,
            event: "ACK_A",
            actor: "PARTY_A",
            virtual_ts_ms: "100",
            real_ts_iso: "2026-11-11T09:00:01.000Z",
            data: {},
            tx_sig: "5xTr7YqEXAMPLESIGNATUREAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
        {
            schema_version: 1,
            seq: 2,
            scenario_id: scenarioId,
            event: "LEG_FUNDED",
            actor: "PARTY_B",
            virtual_ts_ms: "500",
            real_ts_iso: "2026-11-11T09:00:02.000Z",
            data: { leg: "LEG2_CAD", amount_cents: "130000" },
            tx_sig: "3kQp9WmEXAMPLESIGNATUREBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        },
        {
            schema_version: 1,
            seq: 3,
            scenario_id: scenarioId,
            event: "LEG2_RELEASED",
            actor: "ENGINE",
            virtual_ts_ms: "6001",
            real_ts_iso: "2026-11-11T09:00:03.000Z",
            data: {},
            tx_sig: "7hNw2KpEXAMPLESIGNATURECCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        },
    ];
}

function buildChain(inputs: readonly ProvenanceInput[]): ProvenanceChain {
    const chain = new ProvenanceChain();
    for (const input of inputs) {
        chain.append(input);
    }
    return chain;
}

interface Harness {
    client: MockProgramClient;
    driver: PublicKey;
    scenario: PublicKey;
    chain: ProvenanceChain;
}

/** Terminal lane plus a finished chain, ready to anchor. */
async function terminalHarness(): Promise<Harness> {
    const client = new MockProgramClient();
    const driver = Keypair.generate().publicKey;
    const partyA = Keypair.generate().publicKey;
    const partyB = Keypair.generate().publicKey;
    const scenario = await openLane(client, driver, partyA, partyB, 1n);
    expectOk(
        await client.markFailed({
            scenario,
            signer: driver,
            reason: "anchor flow fixture",
        }),
    );
    const chain = buildChain(sampleInputs("SR-2026-11-11-0001"));
    return { client, driver, scenario, chain };
}

/**
 * Fake devnet connection returning one pre-encoded ChainHead account.
 * `null` simulates a missing anchor.
 */
function fakeConnectionWithHead(head: AccountInfo<Buffer> | null): Connection {
    return {
        getAccountInfo: vi.fn(async () => head),
    } as unknown as Connection;
}

/** Encode a ChainHead account exactly like the program writes it. */
async function encodeChainHead(
    scenario: PublicKey,
    finalHash: Uint8Array,
    eventCount: bigint,
    anchoredVirtualMs: bigint,
): Promise<AccountInfo<Buffer>> {
    const coder = new BorshAccountsCoder(idlJson as unknown as Idl);
    const data = await coder.encode("ChainHead", {
        scenario,
        final_hash: finalHash,
        event_count: new BN(eventCount.toString()),
        anchored_unix_ts: new BN(1_795_000_000),
        anchored_virtual_ms: new BN(anchoredVirtualMs.toString()),
        bump: 254,
    });
    return {
        data,
        owner: PROGRAM_ID,
        executable: false,
        lamports: 1_000_000,
    };
}

describe("anchorFlow: anchoring a finished chain", () => {
    it("anchors the chain head and verifies against the encoded account", async () => {
        const h = await terminalHarness();

        const result = await anchorTerminalChain(h.client, {
            scenario: h.scenario,
            signer: h.driver,
            chain: h.chain,
            anchored_virtual_ms: T_START_MS,
        });
        expectOk(result);

        // The mock holds the same head the local chain computes.
        const stored = await h.client.fetchChainHead(h.scenario);
        expect(stored.ok).toBe(true);
        if (!stored.ok) {
            return;
        }
        expect(Buffer.from(stored.value.final_hash).toString("hex")).toBe(h.chain.head);
        expect(stored.value.event_count).toBe(BigInt(h.chain.length));
        expect(stored.value.anchored_virtual_ms).toBe(T_START_MS);

        const connection = fakeConnectionWithHead(
            await encodeChainHead(
                h.scenario,
                headToBytes(h.chain.head),
                BigInt(h.chain.length),
                T_START_MS,
            ),
        );
        const verification = await verifyAgainstChainHead(
            connection,
            h.scenario,
            h.chain,
        );
        expect(verification).toEqual({
            valid: true,
            on_chain_head: h.chain.head,
            local_head: h.chain.head,
            event_count_match: true,
        });
    });

    it("rejects anchoring before terminal status and by a non driver", async () => {
        const client = new MockProgramClient();
        const driver = Keypair.generate().publicKey;
        const partyA = Keypair.generate().publicKey;
        const partyB = Keypair.generate().publicKey;
        const scenario = await openLane(client, driver, partyA, partyB, 1n);
        const chain = buildChain(sampleInputs("SR-2026-11-11-0002"));

        const tooEarly = await anchorTerminalChain(client, {
            scenario,
            signer: driver,
            chain,
            anchored_virtual_ms: T_START_MS,
        });
        expect(tooEarly.ok).toBe(false);
        if (!tooEarly.ok) {
            expect(programErrorCode(tooEarly.error)).toBe("BadState");
        }

        expectOk(
            await client.markFailed({ scenario, signer: driver, reason: "terminal" }),
        );
        const wrongSigner = await anchorTerminalChain(client, {
            scenario,
            signer: partyA,
            chain,
            anchored_virtual_ms: T_START_MS,
        });
        expect(wrongSigner.ok).toBe(false);
        if (!wrongSigner.ok) {
            expect(programErrorCode(wrongSigner.error)).toBe("NotParty");
        }

        expectOk(
            await anchorTerminalChain(client, {
                scenario,
                signer: driver,
                chain,
                anchored_virtual_ms: T_START_MS,
            }),
        );
        const again = await anchorTerminalChain(client, {
            scenario,
            signer: driver,
            chain,
            anchored_virtual_ms: T_START_MS,
        });
        expect(again.ok).toBe(false);
        if (!again.ok) {
            expect(programErrorCode(again.error)).toBe("AccountAlreadyInUse");
        }
    });
});

describe("anchorFlow: verifyAgainstChainHead detects tampering", () => {
    it("fails when a local record was edited after anchoring", async () => {
        const h = await terminalHarness();
        expectOk(
            await anchorTerminalChain(h.client, {
                scenario: h.scenario,
                signer: h.driver,
                chain: h.chain,
                anchored_virtual_ms: T_START_MS,
            }),
        );
        const connection = fakeConnectionWithHead(
            await encodeChainHead(
                h.scenario,
                headToBytes(h.chain.head),
                BigInt(h.chain.length),
                T_START_MS,
            ),
        );

        // Edit a record in place without recomputing any hash. The stored
        // head still equals the anchor, but the chain no longer rehashes.
        const victim = h.chain.records[1] as { data: Record<string, unknown> };
        victim.data.tampered = true;

        const verification = await verifyAgainstChainHead(
            connection,
            h.scenario,
            h.chain,
        );
        expect(verification.valid).toBe(false);
        expect(verification.on_chain_head).toBe(h.chain.head);
        expect(verification.local_head).toBe(h.chain.head);
        expect(verification.event_count_match).toBe(true);
        expect(h.chain.verify()).toBe(false);
    });

    it("fails event count match when the local chain was truncated", async () => {
        const h = await terminalHarness();
        expectOk(
            await anchorTerminalChain(h.client, {
                scenario: h.scenario,
                signer: h.driver,
                chain: h.chain,
                anchored_virtual_ms: T_START_MS,
            }),
        );
        const connection = fakeConnectionWithHead(
            await encodeChainHead(
                h.scenario,
                headToBytes(h.chain.head),
                BigInt(h.chain.length),
                T_START_MS,
            ),
        );

        // Drop the tail: every remaining record still verifies standalone,
        // which is exactly why the anchored event count is required.
        const inputs = sampleInputs("SR-2026-11-11-0001");
        const truncated = buildChain(inputs.slice(0, 2));
        expect(truncated.verify()).toBe(true);

        const verification = await verifyAgainstChainHead(
            connection,
            h.scenario,
            truncated,
        );
        expect(verification.valid).toBe(false);
        expect(verification.event_count_match).toBe(false);
        expect(verification.on_chain_head).not.toBe(truncated.head);
        expect(verification.local_head).toBe(truncated.head);
    });

    it("reports no anchor when the account is missing or foreign", async () => {
        const h = await terminalHarness();
        const chain = buildChain(sampleInputs("SR-2026-11-11-0003"));

        const missing = await verifyAgainstChainHead(
            fakeConnectionWithHead(null),
            h.scenario,
            chain,
        );
        expect(missing).toEqual({
            valid: false,
            on_chain_head: null,
            local_head: chain.head,
            event_count_match: false,
        });
        expect(missing.local_head).not.toBe(GENESIS_HASH);

        // An account owned by another program is not an anchor either.
        const foreign = await encodeChainHead(
            h.scenario,
            headToBytes(chain.head),
            BigInt(chain.length),
            T_START_MS,
        );
        const connection = fakeConnectionWithHead({
            ...foreign,
            owner: Keypair.generate().publicKey,
        });
        const notOurs = await verifyAgainstChainHead(connection, h.scenario, chain);
        expect(notOurs.on_chain_head).toBeNull();
        expect(notOurs.valid).toBe(false);
    });

    it("propagates transport failures instead of reporting an invalid chain", async () => {
        const h = await terminalHarness();
        const chain = buildChain(sampleInputs("SR-2026-11-11-0005"));
        const getAccountInfo = vi.fn(async () => {
            throw new Error("Failed to fetch account info: connection refused");
        });
        const connection = { getAccountInfo } as unknown as Connection;

        // An unreachable cluster must reject: resolving with valid:false
        // would read a transport outage as tampering.
        await expect(
            verifyAgainstChainHead(connection, h.scenario, chain),
        ).rejects.toThrow("connection refused");
        expect(getAccountInfo).toHaveBeenCalledTimes(1);
    });
});

describe("anchorFlow: headToBytes", () => {
    it("round trips a chain head through hex", () => {
        const chain = buildChain(sampleInputs("SR-2026-11-11-0004"));
        const bytes = headToBytes(chain.head);
        expect(bytes).toHaveLength(32);
        expect(Buffer.from(bytes).toString("hex")).toBe(chain.head);
    });

    it("rejects malformed heads", () => {
        expect(() => headToBytes("abc")).toThrow("64 hex characters");
        expect(() => headToBytes("z".repeat(64))).toThrow("64 hex characters");
    });
});
