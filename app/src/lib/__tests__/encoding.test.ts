/**
 * Offline instruction encoding tests for the devnet AnchorClient.
 *
 * docs/reviews.md (Phase 3 code review, Medium) found that no test ever
 * executed an Anchor methods builder: the account fetch decode side was
 * pinned in anchorClient.test.ts, but the instruction path (camel case
 * method and account names, enum variant keys, little endian integers
 * against the snake case committed IDL) was not. A mismatch there would
 * first have surfaced at the live devnet smoke run.
 *
 * The harness intercepts `AnchorProvider.prototype.sendAndConfirm`, so
 * every client method runs its full builder path (methods.<ix>() with
 * accountsStrict / remainingAccounts, then the BorshInstructionCoder
 * encode inside the transaction factory) but the assembled transaction
 * never leaves the process: the captured TransactionInstruction is the
 * exact payload rpc() would have signed and sent. Nothing in this file
 * touches the network.
 *
 * Discriminators are recomputed here from sha256("global:<snake_name>")
 * first 8 bytes, so the assertions do not trust the bytes stored in the
 * committed IDL; a separate check pins the IDL's stored discriminators
 * against the same computation.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { AnchorProvider } from "@anchor-lang/core";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import type {
    Connection,
    TransactionInstruction,
    VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AnchorClient, keypairWallet } from "../anchorClient";
import {
    PROGRAM_ID,
    chainHeadPda,
    scenarioPda,
    vaultCadPda,
    vaultUsdPda,
} from "../pda";
import type { TxResult } from "../programClient";
import idlJson from "../settlement_race.json";

const USD_MINT = Keypair.generate().publicKey;
const CAD_MINT = Keypair.generate().publicKey;
const TICKET_HASH = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
/** Wide u64 so little endian byte order and the full 8 byte width show. */
const SCENARIO_ID = 0x1122334455667788n;
/** Same id plus one for the second lane (only the seed differs). */
const SCENARIO_ID_ATOMIC = SCENARIO_ID + 1n;
const LEG1_USD_CENTS = 1_000_000n;
const LEG2_CAD_CENTS = 1_350_000n;
/** MAX_GAP_MS, the boundary the program accepts. */
const GAP_MS = 86_400_000n;
const ADVANCE_TO_MS = 7_001n;
const EVENT_COUNT = 8n;
const FINAL_HASH = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const MARK_FAILED_REASON = "phase3 smoke";

/** Every capture in buildMatrix, mapped to its snake case IDL name. */
const CAPTURES: ReadonlyArray<readonly [string, string]> = [
    ["initialize_scenario", "initialize_scenario"],
    ["acknowledge:party_a", "acknowledge"],
    ["acknowledge:party_b", "acknowledge"],
    ["fund_leg:leg1_usd", "fund_leg"],
    ["fund_leg:leg2_cad", "fund_leg"],
    ["start_race:sequential", "start_race"],
    ["advance_clock", "advance_clock"],
    ["release_leg1", "release_leg1"],
    ["release_leg2_partial", "release_leg2_partial"],
    ["release_leg2", "release_leg2"],
    ["declare_default", "declare_default"],
    ["settle_atomic", "settle_atomic"],
    ["mark_failed:reason", "mark_failed"],
    ["mark_failed:default", "mark_failed"],
    ["anchor_chain_head", "anchor_chain_head"],
    ["start_race:atomic", "start_race"],
];

/** Captured instructions, in execution order. */
const captured: TransactionInstruction[] = [];
/** Keyed by the CAPTURES label. */
const matrix = new Map<string, TransactionInstruction>();
const originalSendAndConfirm = AnchorProvider.prototype.sendAndConfirm;

/**
 * Intercept the provider send: build the transaction exactly as rpc()
 * would, record its single instruction, and return a synthetic signature.
 */
function installCapture(): void {
    AnchorProvider.prototype.sendAndConfirm = async function (
        tx: Transaction | VersionedTransaction,
    ): Promise<string> {
        if (!(tx instanceof Transaction)) {
            throw new Error("encoding harness: expected a legacy Transaction");
        }
        if (tx.instructions.length !== 1) {
            throw new Error(
                `encoding harness: expected exactly 1 instruction, got ${tx.instructions.length}`,
            );
        }
        const ix = tx.instructions[0];
        if (ix === undefined) {
            throw new Error("encoding harness: instruction missing");
        }
        captured.push(ix);
        return `captured_${captured.length}`;
    };
}

interface Harness {
    client: AnchorClient;
    driver: PublicKey;
    partyA: PublicKey;
    partyB: PublicKey;
    scenario: PublicKey;
    atomicScenario: PublicKey;
}

/**
 * Drive one sequential and one atomic lane through every client method so
 * all twelve instructions are built offline. No state guard runs here (the
 * program enforces those on chain), so the call order only mirrors the
 * honest sequential flow for readability.
 */
async function buildMatrix(): Promise<Harness> {
    const driver = Keypair.generate();
    const partyA = Keypair.generate();
    const partyB = Keypair.generate();
    // The connection is never dialed: the capture intercepts every send
    // and the only reads (partiesFor) are satisfied from initScenario.
    const client = new AnchorClient({
        connection: {} as unknown as Connection,
        usdMint: USD_MINT,
        cadMint: CAD_MINT,
        driver,
        partyB,
        wallet: keypairWallet(partyA),
    });
    const [scenario] = scenarioPda(driver.publicKey, SCENARIO_ID);
    const [atomicScenario] = scenarioPda(driver.publicKey, SCENARIO_ID_ATOMIC);

    await capture("initialize_scenario", () =>
        client.initScenario({
            driver: driver.publicKey,
            party_a: partyA.publicKey,
            party_b: partyB.publicKey,
            scenario_id: SCENARIO_ID,
            ticket_hash: TICKET_HASH,
            path: "SEQUENTIAL",
            leg1_usd_cents: LEG1_USD_CENTS,
            leg2_cad_cents: LEG2_CAD_CENTS,
            gap_ms: GAP_MS,
        }),
    );
    await capture("acknowledge:party_a", () =>
        client.ack({ scenario, signer: partyA.publicKey }),
    );
    await capture("acknowledge:party_b", () =>
        client.ack({ scenario, signer: partyB.publicKey }),
    );
    await capture("fund_leg:leg1_usd", () =>
        client.fundLeg({
            scenario,
            signer: partyA.publicKey,
            leg: "LEG1_USD",
            amount_cents: LEG1_USD_CENTS,
        }),
    );
    await capture("fund_leg:leg2_cad", () =>
        client.fundLeg({
            scenario,
            signer: partyB.publicKey,
            leg: "LEG2_CAD",
            amount_cents: LEG2_CAD_CENTS,
        }),
    );
    await capture("start_race:sequential", () =>
        client.startRace({ scenario, signer: driver.publicKey }),
    );
    await capture("advance_clock", () =>
        client.advanceClock({
            scenario,
            signer: driver.publicKey,
            to_ms: ADVANCE_TO_MS,
        }),
    );
    await capture("release_leg1", () =>
        client.releaseLeg1({ scenario, signer: driver.publicKey }),
    );
    await capture("release_leg2_partial", () =>
        client.releaseLeg2Partial({
            scenario,
            signer: partyB.publicKey,
            amount_cents: 1n,
        }),
    );
    await capture("release_leg2", () =>
        client.releaseLeg2({ scenario, signer: partyB.publicKey }),
    );
    await capture("declare_default", () =>
        client.declareDefault({ scenario, signer: driver.publicKey }),
    );
    await capture("settle_atomic", () =>
        client.settleAtomic({ scenario, signer: driver.publicKey }),
    );
    await capture("mark_failed:reason", () =>
        client.markFailed({
            scenario,
            signer: driver.publicKey,
            reason: MARK_FAILED_REASON,
        }),
    );
    await capture("mark_failed:default", () =>
        client.markFailed({ scenario, signer: driver.publicKey }),
    );
    await capture("anchor_chain_head", () =>
        client.anchorChainHead({
            scenario,
            signer: driver.publicKey,
            final_hash: FINAL_HASH,
            event_count: EVENT_COUNT,
            anchored_virtual_ms: ADVANCE_TO_MS,
        }),
    );
    // The atomic lane reuses the identical initialize builder (only the
    // scenario seed differs), so the path is registered directly and the
    // second start_race captures the atomic enum variant.
    client.registerLanePath(atomicScenario, "ATOMIC");
    await capture("start_race:atomic", () =>
        client.startRace({
            scenario: atomicScenario,
            signer: driver.publicKey,
        }),
    );

    return {
        client,
        driver: driver.publicKey,
        partyA: partyA.publicKey,
        partyB: partyB.publicKey,
        scenario,
        atomicScenario,
    };
}

/** Run one client method and record the single instruction it built. */
async function capture(name: string, exec: () => Promise<TxResult>): Promise<void> {
    const before = captured.length;
    const result = await exec();
    if (!result.ok) {
        throw new Error(`capture "${name}" failed before building: ${result.error}`);
    }
    if (captured.length !== before + 1) {
        throw new Error(
            `capture "${name}": expected 1 instruction, saw ${captured.length - before}`,
        );
    }
    const ix = captured[captured.length - 1];
    if (ix === undefined) {
        throw new Error(`capture "${name}": instruction missing`);
    }
    matrix.set(name, ix);
}

let harness: Harness | null = null;

function h(): Harness {
    if (harness === null) {
        throw new Error("encoding matrix was not built");
    }
    return harness;
}

function instruction(name: string): TransactionInstruction {
    const ix = matrix.get(name);
    if (ix === undefined) {
        throw new Error(`instruction never captured: ${name}`);
    }
    return ix;
}

function keys(name: string): string[] {
    return instruction(name).keys.map((meta) => meta.pubkey.toBase58());
}

function data(name: string): Buffer {
    return Buffer.from(instruction(name).data);
}

/** sha256("global:<snake_case_name>") first 8 bytes, computed here. */
function disc(snakeName: string): Buffer {
    return createHash("sha256")
        .update(`global:${snakeName}`)
        .digest()
        .subarray(0, 8);
}

function leU64(value: bigint): Buffer {
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(value);
    return out;
}

function leI64(value: bigint): Buffer {
    const out = Buffer.alloc(8);
    out.writeBigInt64LE(value);
    return out;
}

function leU32(value: number): Buffer {
    const out = Buffer.alloc(4);
    out.writeUInt32LE(value);
    return out;
}

const b58 = (key: PublicKey): string => key.toBase58();

describe("AnchorClient: offline instruction encoding", () => {
    beforeAll(async () => {
        installCapture();
        harness = await buildMatrix();
    });

    afterAll(() => {
        AnchorProvider.prototype.sendAndConfirm = originalSendAndConfirm;
    });

    it("gives every instruction the sha256 discriminator and covers all twelve names", () => {
        const covered = new Set<string>();
        for (const [label, snakeName] of CAPTURES) {
            const ix = instruction(label);
            expect(ix.programId.equals(PROGRAM_ID), label).toBe(true);
            expect(Array.from(ix.data.subarray(0, 8)), label).toEqual(
                Array.from(disc(snakeName)),
            );
            covered.add(snakeName);
        }
        // Completeness: the captures exercise every instruction the IDL
        // declares, exactly once as a distinct name.
        const idlNames = idlJson.instructions.map((entry) => entry.name);
        expect(covered.size).toBe(idlNames.length);
        expect([...covered].sort()).toEqual([...idlNames].sort());

        // The committed IDL's stored discriminators agree with the Anchor
        // convention too, so a regenerated IDL cannot drift silently.
        for (const entry of idlJson.instructions) {
            expect(Array.from(entry.discriminator), entry.name).toEqual(
                Array.from(disc(entry.name)),
            );
        }
    });

    it("orders initialize_scenario accounts as the client builds them, parties last", () => {
        const { scenario, driver, partyA, partyB } = h();
        expect(keys("initialize_scenario")).toEqual([
            b58(scenario),
            b58(driver),
            b58(USD_MINT),
            b58(CAD_MINT),
            b58(vaultUsdPda(scenario)[0]),
            b58(vaultCadPda(scenario)[0]),
            b58(TOKEN_PROGRAM_ID),
            b58(SystemProgram.programId),
            b58(partyA),
            b58(partyB),
        ]);
        // Signer and writable flags: driver pays and signs, the two
        // remaining accounts are read only non signers.
        expect(
            instruction("initialize_scenario").keys.map((meta) => ({
                signer: meta.isSigner,
                writable: meta.isWritable,
            })),
        ).toEqual([
            { signer: false, writable: true },
            { signer: true, writable: true },
            { signer: false, writable: false },
            { signer: false, writable: false },
            { signer: false, writable: true },
            { signer: false, writable: true },
            { signer: false, writable: false },
            { signer: false, writable: false },
            { signer: false, writable: false },
            { signer: false, writable: false },
        ]);
    });

    it("encodes initialize_scenario data as id, ticket hash, notionals, and gap", () => {
        const expected = Buffer.concat([
            disc("initialize_scenario"),
            leU64(SCENARIO_ID),
            Buffer.from(TICKET_HASH),
            leU64(LEG1_USD_CENTS),
            leU64(LEG2_CAD_CENTS),
            leI64(GAP_MS),
        ]);
        expect(data("initialize_scenario")).toEqual(expected);
        // Explicit width checks: u64 scenario id is 8 LE bytes, the ticket
        // hash is the next 32 bytes verbatim, gap_ms is i64 LE.
        const raw = data("initialize_scenario");
        expect(raw.subarray(8, 16)).toEqual(leU64(SCENARIO_ID));
        expect(raw.subarray(16, 48)).toEqual(Buffer.from(TICKET_HASH));
        expect(raw.subarray(64, 72)).toEqual(leI64(GAP_MS));
        expect(raw).toHaveLength(72);
    });

    it("encodes fund_leg with both leg enum variants and LE amounts", () => {
        const { scenario, partyA, partyB } = h();
        expect(keys("fund_leg:leg1_usd")).toEqual([
            b58(scenario),
            b58(partyA),
            b58(getAssociatedTokenAddressSync(USD_MINT, partyA)),
            b58(vaultUsdPda(scenario)[0]),
            b58(vaultCadPda(scenario)[0]),
            b58(TOKEN_PROGRAM_ID),
        ]);
        expect(keys("fund_leg:leg2_cad")).toEqual([
            b58(scenario),
            b58(partyB),
            b58(getAssociatedTokenAddressSync(CAD_MINT, partyB)),
            b58(vaultUsdPda(scenario)[0]),
            b58(vaultCadPda(scenario)[0]),
            b58(TOKEN_PROGRAM_ID),
        ]);
        // Leg enum discriminant: { leg1Usd: {} } -> 0, { leg2Cad: {} } -> 1,
        // then the u64 amount little endian.
        expect(data("fund_leg:leg1_usd")).toEqual(
            Buffer.concat([disc("fund_leg"), Buffer.from([0]), leU64(LEG1_USD_CENTS)]),
        );
        expect(data("fund_leg:leg2_cad")).toEqual(
            Buffer.concat([disc("fund_leg"), Buffer.from([1]), leU64(LEG2_CAD_CENTS)]),
        );
        expect(data("fund_leg:leg1_usd")).toHaveLength(17);
        expect(data("fund_leg:leg2_cad")).toHaveLength(17);
    });

    it("encodes start_race with both path enum variants", () => {
        const { scenario, atomicScenario, driver } = h();
        expect(keys("start_race:sequential")).toEqual([b58(scenario), b58(driver)]);
        expect(keys("start_race:atomic")).toEqual([
            b58(atomicScenario),
            b58(driver),
        ]);
        // Path enum discriminant: { sequential: {} } -> 0, { atomic: {} } -> 1.
        expect(data("start_race:sequential")).toEqual(
            Buffer.concat([disc("start_race"), Buffer.from([0])]),
        );
        expect(data("start_race:atomic")).toEqual(
            Buffer.concat([disc("start_race"), Buffer.from([1])]),
        );
        expect(data("start_race:sequential")).toHaveLength(9);
    });

    it("orders settle_atomic with both vaults and both party ATAs", () => {
        const { scenario, driver, partyA, partyB } = h();
        expect(keys("settle_atomic")).toEqual([
            b58(scenario),
            b58(driver),
            b58(vaultUsdPda(scenario)[0]),
            b58(vaultCadPda(scenario)[0]),
            b58(getAssociatedTokenAddressSync(USD_MINT, partyB)),
            b58(getAssociatedTokenAddressSync(CAD_MINT, partyA)),
            b58(TOKEN_PROGRAM_ID),
        ]);
        // No arguments: data is the bare discriminator.
        expect(data("settle_atomic")).toEqual(disc("settle_atomic"));
        // The driver signs but is read only here: settle_atomic marks only
        // scenario as mut in Rust, so the IDL (and this instruction) carry
        // signer true and writable false for the driver key.
        expect(
            instruction("settle_atomic").keys.map((meta) => ({
                signer: meta.isSigner,
                writable: meta.isWritable,
            })),
        ).toEqual([
            { signer: false, writable: true },
            { signer: true, writable: false },
            { signer: false, writable: true },
            { signer: false, writable: true },
            { signer: false, writable: true },
            { signer: false, writable: true },
            { signer: false, writable: false },
        ]);
    });

    it("keeps the no-argument instructions at exactly the discriminator with role accounts", () => {
        const { scenario, driver, partyA, partyB } = h();
        expect(keys("acknowledge:party_a")).toEqual([b58(scenario), b58(partyA)]);
        expect(keys("acknowledge:party_b")).toEqual([b58(scenario), b58(partyB)]);
        expect(keys("release_leg1")).toEqual([
            b58(scenario),
            b58(driver),
            b58(vaultUsdPda(scenario)[0]),
            b58(getAssociatedTokenAddressSync(USD_MINT, partyB)),
            b58(TOKEN_PROGRAM_ID),
        ]);
        expect(keys("release_leg2")).toEqual([
            b58(scenario),
            b58(partyB),
            b58(vaultCadPda(scenario)[0]),
            b58(getAssociatedTokenAddressSync(CAD_MINT, partyA)),
            b58(TOKEN_PROGRAM_ID),
        ]);
        expect(keys("declare_default")).toEqual([
            b58(scenario),
            b58(driver),
            b58(vaultCadPda(scenario)[0]),
            b58(getAssociatedTokenAddressSync(CAD_MINT, partyB)),
            b58(TOKEN_PROGRAM_ID),
        ]);
        for (const label of [
            "acknowledge:party_a",
            "acknowledge:party_b",
            "release_leg1",
            "release_leg2",
            "declare_default",
        ]) {
            expect(data(label), label).toEqual(
                disc(CAPTURES.find(([name]) => name === label)?.[1] ?? ""),
            );
            expect(data(label), label).toHaveLength(8);
        }
    });

    it("encodes advance_clock, partial release, mark_failed, and the anchor little endian", () => {
        const { scenario, driver, partyA, partyB } = h();
        expect(keys("advance_clock")).toEqual([b58(scenario), b58(driver)]);
        expect(data("advance_clock")).toEqual(
            Buffer.concat([disc("advance_clock"), leI64(ADVANCE_TO_MS)]),
        );

        expect(keys("release_leg2_partial")).toEqual([
            b58(scenario),
            b58(partyB),
            b58(vaultCadPda(scenario)[0]),
            b58(getAssociatedTokenAddressSync(CAD_MINT, partyA)),
            b58(TOKEN_PROGRAM_ID),
        ]);
        expect(data("release_leg2_partial")).toEqual(
            Buffer.concat([disc("release_leg2_partial"), leU64(1n)]),
        );

        // mark_failed: u32 LE string length then UTF-8 bytes; the client
        // defaults a missing reason to the empty string.
        expect(data("mark_failed:reason")).toEqual(
            Buffer.concat([
                disc("mark_failed"),
                leU32(Buffer.byteLength(MARK_FAILED_REASON)),
                Buffer.from(MARK_FAILED_REASON, "utf8"),
            ]),
        );
        expect(data("mark_failed:default")).toEqual(
            Buffer.concat([disc("mark_failed"), leU32(0)]),
        );
        expect(data("mark_failed:default")).toHaveLength(12);

        expect(keys("anchor_chain_head")).toEqual([
            b58(scenario),
            b58(driver),
            b58(chainHeadPda(scenario)[0]),
            b58(SystemProgram.programId),
        ]);
        expect(data("anchor_chain_head")).toEqual(
            Buffer.concat([
                disc("anchor_chain_head"),
                Buffer.from(FINAL_HASH),
                leU64(EVENT_COUNT),
                leI64(ADVANCE_TO_MS),
            ]),
        );
        expect(data("anchor_chain_head")).toHaveLength(56);
    });
});
