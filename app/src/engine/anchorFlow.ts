/**
 * Anchor flow glue: write a finished provenance chain to the on-chain
 * `ChainHead` account, and verify a local chain against that anchor.
 *
 * The hash chain alone proves internal consistency; anchoring the final
 * head in one devnet transaction converts it into tamper evidence against
 * an independent timestamped record. Verification compares the local head
 * and length with the anchor, which is also what detects tail truncation:
 * `verifyRecords` accepts any prefix of a valid chain on its own, so a
 * dropped suffix shows up only as `event_count_match: false` here (see
 * docs/reviews.md, Phase 3 note).
 *
 * No engine state moves in this module: the caller asserts the scenario is
 * terminal first, and the program re-checks that guard itself.
 */

import { BorshAccountsCoder } from "@anchor-lang/core";
import type { Idl } from "@anchor-lang/core";
import type { Connection, PublicKey } from "@solana/web3.js";
import idlJson from "../lib/settlement_race.json";
import { PROGRAM_ID, chainHeadPda } from "../lib/pda";
import type { ProgramClient, TxResult } from "../lib/programClient";
import { ProvenanceChain } from "../lib/provenance";

/** Result of comparing a local chain with the on-chain anchor. */
export interface ChainHeadVerification {
    /** True when the chain verifies, the head matches, and the count matches. */
    valid: boolean;
    /** Anchored head as lowercase hex, or null when no anchor exists. */
    on_chain_head: string | null;
    /** Local chain head as lowercase hex. */
    local_head: string;
    /** True when the anchored event count equals the local chain length. */
    event_count_match: boolean;
}

/** Inputs for anchoring one finished chain. */
export interface AnchorTerminalArgs {
    scenario: PublicKey;
    /** Driver signer authorized to call anchor_chain_head. */
    signer: PublicKey;
    /** Finished chain in its terminal scenario. */
    chain: ProvenanceChain;
    /** Virtual clock time recorded as the anchor time. */
    anchored_virtual_ms: bigint;
}

/**
 * Decode ChainHead accounts from the committed IDL. Built once: the coder
 * is stateless and expensive to reconstruct.
 */
const headCoder = new BorshAccountsCoder(idlJson as unknown as Idl);

/**
 * Convert a 64 character hex chain head into the 32 byte instruction
 * argument.
 *
 * @throws Error when the head is not 64 hex characters.
 */
export function headToBytes(headHex: string): Uint8Array {
    if (!/^[0-9a-f]{64}$/i.test(headHex)) {
        throw new Error(
            `headToBytes: expected 64 hex characters, got ${headHex.length}`,
        );
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = Number.parseInt(headHex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/** Lowercase hex of a 32 byte hash. */
function bytesToHex(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}

/**
 * Anchor a finished chain in one devnet transaction: the chain head and
 * length become the `ChainHead` PDA fields. The program rejects non
 * terminal scenarios and non driver signers itself, so this helper only
 * converts and forwards.
 */
export async function anchorTerminalChain(
    client: ProgramClient,
    args: AnchorTerminalArgs,
): Promise<TxResult> {
    let final_hash: Uint8Array;
    try {
        final_hash = headToBytes(args.chain.head);
    } catch (err) {
        return {
            ok: false,
            error: `InvalidInstructionData: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    return client.anchorChainHead({
        scenario: args.scenario,
        signer: args.signer,
        final_hash,
        event_count: BigInt(args.chain.length),
        anchored_virtual_ms: args.anchored_virtual_ms,
    });
}

/** Shape decoded from a ChainHead account (raw IDL field names). */
interface DecodedChainHead {
    final_hash: number[];
    event_count: { toString(): string };
}

/**
 * Verify a local chain against the on-chain `ChainHead` PDA.
 *
 * `valid` requires all three: the local chain rehashes without a broken
 * link (catches in-place tampering), the local head equals the anchored
 * head (catches rewritten tails, whose recomputed hashes differ), and the
 * local length equals the anchored event count (catches tail truncation,
 * which a standalone verifyRecords run cannot see because any prefix of a
 * valid chain still verifies).
 *
 * A missing or foreign account yields `on_chain_head: null` and
 * `valid: false`. RPC transport failures propagate to the caller: an
 * unreachable cluster must not read as an invalid chain.
 */
export async function verifyAgainstChainHead(
    connection: Connection,
    scenario: PublicKey,
    chain: ProvenanceChain,
    programId: PublicKey = PROGRAM_ID,
): Promise<ChainHeadVerification> {
    const local_head = chain.head;
    const [address] = chainHeadPda(scenario, programId);
    const info = await connection.getAccountInfo(address, "confirmed");
    if (info === null || !info.owner.equals(programId)) {
        return {
            valid: false,
            on_chain_head: null,
            local_head,
            event_count_match: false,
        };
    }
    let decoded: DecodedChainHead;
    try {
        decoded = headCoder.decodeAny(info.data) as DecodedChainHead;
    } catch {
        return {
            valid: false,
            on_chain_head: null,
            local_head,
            event_count_match: false,
        };
    }
    const on_chain_head = bytesToHex(Uint8Array.from(decoded.final_hash));
    const event_count_match =
        BigInt(decoded.event_count.toString()) === BigInt(chain.length);
    const head_match = on_chain_head === local_head;
    const valid = chain.verify() && head_match && event_count_match;
    return { valid, on_chain_head, local_head, event_count_match };
}
