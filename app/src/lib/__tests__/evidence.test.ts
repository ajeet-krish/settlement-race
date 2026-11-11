import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import {
    attachEvidence,
    fetchEvidence,
    verifyEvidence,
} from "../evidence";
import { PROGRAM_ID } from "../pda";
import { ProvenanceChain, type ProvenanceInput } from "../provenance";

const BLOCK_TIME = 1_795_000_000;

/**
 * Shape-valid fake signature: base58 alphabet only, padded into the upper
 * half of the accepted length window (real signatures encode 64 bytes into
 * 87 or 88 base58 characters). Evidence validation checks shape only, so
 * this stands in for a real signature without touching the network.
 */
function fakeSig(tag: string): string {
    const kept = tag.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");
    const base = kept.length > 0 ? kept : "1";
    return (base + "1".repeat(87)).slice(0, 87);
}

const SIG_OK = fakeSig("example");
const SIG_FAILED = fakeSig("failed");
const SIG_FOREIGN = fakeSig("foreign");
const SIG_MISSING = fakeSig("missing");
const SIG_THROTTLED = fakeSig("throttled");
const SIG_PRUNED = fakeSig("pruned");
const SIG_RAW = fakeSig("rawonly");
const SIG_V0 = fakeSig("v0sig");
const SIG_GOOD = fakeSig("good");
const SIG_RATE = fakeSig("bad");
const SIG_GONE = fakeSig("gone");

/** Parsed transaction shape with one instruction from the given program. */
function parsedTx(options: {
    programId?: PublicKey;
    err?: unknown;
    blockTime?: number | null;
}): unknown {
    const programId = options.programId ?? PROGRAM_ID;
    return {
        slot: 1,
        blockTime: options.blockTime === undefined ? BLOCK_TIME : options.blockTime,
        meta: { err: options.err ?? null },
        transaction: {
            message: {
                accountKeys: [
                    { pubkey: Keypair.generate().publicKey, signer: true, writable: true },
                    { pubkey: programId, signer: false, writable: false },
                ],
                instructions: [
                    {
                        program: "settlement_race",
                        programId,
                        parsed: { type: "initializeScenario" },
                    },
                ],
            },
        },
    };
}

/** Raw json transaction using programIdIndex into plain string keys. */
function jsonTx(options: { programId?: PublicKey; err?: unknown }): unknown {
    const programId = options.programId ?? PROGRAM_ID;
    return {
        slot: 2,
        blockTime: BLOCK_TIME,
        meta: { err: options.err ?? null, loadedAddresses: null },
        transaction: {
            message: {
                accountKeys: [
                    Keypair.generate().publicKey.toBase58(),
                    programId.toBase58(),
                ],
                instructions: [{ programIdIndex: 1, accounts: [0], data: "" }],
            },
        },
    };
}

interface FakeConnection {
    connection: Connection;
    parsed: ReturnType<typeof vi.fn>;
    raw: ReturnType<typeof vi.fn>;
}

/**
 * Connection double: each handler receives the signature and either
 * returns a transaction, returns null, or throws (simulating RPC errors).
 */
function fakeConnection(
    handlers: {
        parsed?: (sig: string) => unknown;
        raw?: (sig: string) => unknown;
    } = {},
): FakeConnection {
    const parsed = vi.fn(async (sig: string, _config?: unknown) =>
        handlers.parsed !== undefined ? handlers.parsed(sig) : null,
    );
    const raw = vi.fn(async (sig: string, _config?: unknown) =>
        handlers.raw !== undefined ? handlers.raw(sig) : null,
    );
    const connection = { getParsedTransaction: parsed, getTransaction: raw };
    return { connection: connection as unknown as Connection, parsed, raw };
}

function rateLimitError(status: number): Error {
    const err = new Error(
        status === 429
            ? "failed to get confirmed block: 429 Too Many Requests"
            : "failed to get confirmed block: 410 Gone",
    );
    (err as unknown as { status: number }).status = status;
    return err;
}

function record(input: ProvenanceInput): ProvenanceInput {
    return { ...input };
}

const BASE_RECORD: ProvenanceInput = {
    schema_version: 1,
    seq: 0,
    scenario_id: "SR-2026-11-11-0001",
    event: "TICKET_CREATED",
    actor: "ENGINE",
    virtual_ts_ms: "0",
    real_ts_iso: null,
    data: {},
    tx_sig: null,
};

describe("fetchEvidence", () => {
    it("marks a successful transaction with our program as good evidence", async () => {
        const { connection, parsed, raw } = fakeConnection({
            parsed: () => parsedTx({}),
        });
        const [row] = await fetchEvidence(connection, [SIG_OK]);

        expect(row).toEqual({
            tx_sig: SIG_OK,
            real_ts_iso: new Date(BLOCK_TIME * 1000).toISOString(),
            fetched_ok: true,
            program_id_match: true,
            success: true,
        });
        expect(parsed).toHaveBeenCalledTimes(1);
        expect(parsed.mock.calls[0]?.[1]).toMatchObject({
            maxSupportedTransactionVersion: 0,
        });
        expect(raw).not.toHaveBeenCalled();
    });

    it("keeps fetched_ok but clears success when the transaction failed", async () => {
        const { connection } = fakeConnection({
            parsed: () => parsedTx({ err: { InstructionError: [0, "Custom"] } }),
        });
        const [row] = await fetchEvidence(connection, [SIG_FAILED]);
        expect(row?.fetched_ok).toBe(true);
        expect(row?.success).toBe(false);
        expect(row?.program_id_match).toBe(true);
    });

    it("reports a foreign program as a program id mismatch", async () => {
        const { connection } = fakeConnection({
            parsed: () => parsedTx({ programId: Keypair.generate().publicKey }),
        });
        const [row] = await fetchEvidence(connection, [SIG_FOREIGN]);
        expect(row?.fetched_ok).toBe(true);
        expect(row?.program_id_match).toBe(false);
    });

    it("returns an unfetched row for a missing transaction", async () => {
        const { connection, parsed } = fakeConnection();
        const [row] = await fetchEvidence(connection, [SIG_MISSING]);
        expect(row).toEqual({
            tx_sig: SIG_MISSING,
            real_ts_iso: "",
            fetched_ok: false,
            program_id_match: false,
            success: false,
            reason: "not_found",
        });
        expect(parsed).toHaveBeenCalledTimes(1);
    });

    it("retries a 429 rate limit and then succeeds", async () => {
        let calls = 0;
        const { connection, parsed } = fakeConnection({
            parsed: () => {
                calls += 1;
                if (calls <= 2) {
                    throw rateLimitError(429);
                }
                return parsedTx({});
            },
        });
        const [row] = await fetchEvidence(connection, [SIG_THROTTLED], {
            retryDelayMs: 0,
        });
        expect(row?.fetched_ok).toBe(true);
        expect(parsed).toHaveBeenCalledTimes(3);
    });

    it("gives up with fetched_ok false after the retry budget for 410", async () => {
        const { connection, parsed } = fakeConnection({
            parsed: () => {
                throw rateLimitError(410);
            },
        });
        const [row] = await fetchEvidence(connection, [SIG_PRUNED], {
            retries: 1,
            retryDelayMs: 0,
        });
        expect(row?.fetched_ok).toBe(false);
        expect(row?.reason).toBe("retries_exhausted");
        expect(parsed).toHaveBeenCalledTimes(2);
    });

    it("falls back to the raw fetch when the parsed path rejects", async () => {
        const { connection, parsed, raw } = fakeConnection({
            parsed: () => {
                throw new Error("Transaction version not supported");
            },
            raw: () => jsonTx({}),
        });
        const [row] = await fetchEvidence(connection, [SIG_RAW]);
        expect(parsed).toHaveBeenCalledTimes(1);
        expect(raw).toHaveBeenCalledTimes(1);
        expect(row?.fetched_ok).toBe(true);
        expect(row?.program_id_match).toBe(true);
        expect(row?.success).toBe(true);
    });

    it("resolves compiled programIdIndex against static and loaded keys", async () => {
        const other = Keypair.generate().publicKey;
        const v0 = {
            slot: 3,
            blockTime: BLOCK_TIME,
            meta: {
                err: null,
                loadedAddresses: {
                    writable: [
                        other.toBase58(),
                        Keypair.generate().publicKey.toBase58(),
                    ],
                    readonly: [PROGRAM_ID.toBase58()],
                },
            },
            transaction: {
                message: {
                    staticAccountKeys: [
                        other.toBase58(),
                        Keypair.generate().publicKey.toBase58(),
                    ],
                    compiledInstructions: [
                        { programIdIndex: 4, accountKeyIndexes: [0], data: "" },
                    ],
                },
            },
        };
        const { connection } = fakeConnection({ parsed: () => v0 });
        const [row] = await fetchEvidence(connection, [SIG_V0]);
        expect(row?.program_id_match).toBe(true);
    });

    it("keeps order and never throws across a mixed batch", async () => {
        const { connection } = fakeConnection({
            parsed: (sig) => {
                if (sig === SIG_RATE) {
                    throw rateLimitError(429);
                }
                if (sig === SIG_GOOD) {
                    return parsedTx({});
                }
                return null;
            },
        });
        const rows = await fetchEvidence(connection, [SIG_GOOD, SIG_RATE, SIG_GONE], {
            retries: 0,
            retryDelayMs: 0,
        });
        expect(rows.map((row) => row.tx_sig)).toEqual([SIG_GOOD, SIG_RATE, SIG_GONE]);
        expect(rows.map((row) => row.fetched_ok)).toEqual([true, false, false]);
    });
});

describe("fetchEvidence: input validation and bounds", () => {
    it("degrades malformed signatures to invalid_signature with zero RPC calls", async () => {
        const { connection, parsed, raw } = fakeConnection({
            parsed: () => parsedTx({}),
        });
        const rows = await fetchEvidence(connection, [
            "not-a-sig",
            "short",
            "0".repeat(40),
            `${SIG_OK.slice(0, 86)}l`,
        ]);

        expect(rows).toHaveLength(4);
        for (const row of rows) {
            expect(row.fetched_ok).toBe(false);
            expect(row.reason).toBe("invalid_signature");
            expect(row.real_ts_iso).toBe("");
            expect(row.program_id_match).toBe(false);
            expect(row.success).toBe(false);
        }
        expect(parsed).not.toHaveBeenCalled();
        expect(raw).not.toHaveBeenCalled();
    });

    it("still fetches the valid signatures of a mixed batch", async () => {
        const { connection, parsed } = fakeConnection({
            parsed: () => parsedTx({}),
        });
        const rows = await fetchEvidence(connection, ["not-a-sig", SIG_OK]);

        expect(rows.map((row) => row.fetched_ok)).toEqual([false, true]);
        expect(rows[0]?.reason).toBe("invalid_signature");
        expect(parsed).toHaveBeenCalledTimes(1);
    });

    it("clamps Infinity and oversized retry budgets to five extra attempts", async () => {
        const cases: Array<{ retries: number; attempts: number }> = [
            { retries: Number.POSITIVE_INFINITY, attempts: 6 },
            { retries: 99, attempts: 6 },
            { retries: Number.NaN, attempts: 3 },
            { retries: -10, attempts: 1 },
        ];
        for (const { retries, attempts } of cases) {
            const { connection, parsed } = fakeConnection({
                parsed: () => {
                    throw rateLimitError(429);
                },
            });
            const [row] = await fetchEvidence(connection, [SIG_THROTTLED], {
                retries,
                retryDelayMs: 0,
            });
            expect(row?.fetched_ok).toBe(false);
            expect(row?.reason).toBe("retries_exhausted");
            // First attempt plus the clamped retry budget, never more.
            expect(parsed).toHaveBeenCalledTimes(attempts);
        }
    });

    it("rejects a batch over the signature cap before any network call", async () => {
        const { connection, parsed } = fakeConnection();
        const tooMany = Array.from({ length: 65 }, () => SIG_OK);

        await expect(fetchEvidence(connection, tooMany)).rejects.toThrow(
            "at most 64 signatures per call",
        );
        expect(parsed).not.toHaveBeenCalled();
    });

    it("accepts a batch exactly at the signature cap", async () => {
        const { connection, parsed } = fakeConnection();
        const atCap = Array.from({ length: 64 }, () => SIG_OK);

        const rows = await fetchEvidence(connection, atCap);
        expect(rows).toHaveLength(64);
        expect(parsed).toHaveBeenCalledTimes(64);
    });
});

describe("attachEvidence", () => {
    it("stamps signatures by index without overwriting or mutating", () => {
        const records: ProvenanceInput[] = [
            record(BASE_RECORD),
            record({ ...BASE_RECORD, seq: 1, tx_sig: "alreadystamped" }),
            record({ ...BASE_RECORD, seq: 2 }),
        ];
        const stamped = attachEvidence(records, ["sig0", "sig1", null]);

        expect(stamped[0]?.tx_sig).toBe("sig0");
        expect(stamped[1]?.tx_sig).toBe("alreadystamped");
        expect(stamped[2]?.tx_sig).toBeNull();
        // Inputs stay untouched: the caller still owns the originals.
        expect(records[0]?.tx_sig).toBeNull();
        expect(stamped[0]).not.toBe(records[0]);
    });
});

describe("verifyEvidence", () => {
    function chainWithSigs(): ProvenanceChain {
        const chain = new ProvenanceChain();
        chain.append(record(BASE_RECORD));
        chain.append(
            record({ ...BASE_RECORD, seq: 1, tx_sig: "sigA", event: "ACK_A" }),
        );
        chain.append(
            record({ ...BASE_RECORD, seq: 2, tx_sig: "sigB", event: "ACK_B" }),
        );
        return chain;
    }

    function row(tx_sig: string, fetched_ok: boolean) {
        return {
            tx_sig,
            real_ts_iso: "",
            fetched_ok,
            program_id_match: fetched_ok,
            success: fetched_ok,
        };
    }

    it("passes when every signed record has fetched evidence", () => {
        const chain = chainWithSigs();
        const result = verifyEvidence(chain.records, [
            row("sigA", true),
            row("sigB", true),
        ]);
        expect(result).toEqual({ valid: true, missing_sigs: [] });
    });

    it("lists signatures that never fetched", () => {
        const chain = chainWithSigs();
        const result = verifyEvidence(chain.records, [row("sigA", true)]);
        expect(result.valid).toBe(false);
        expect(result.missing_sigs).toEqual(["sigB"]);
    });

    it("treats an unfetched row as missing evidence", () => {
        const chain = chainWithSigs();
        const result = verifyEvidence(chain.records, [
            row("sigA", false),
            row("sigB", true),
        ]);
        expect(result.valid).toBe(false);
        expect(result.missing_sigs).toEqual(["sigA"]);
    });

    it("skips records that carry no signature", () => {
        const chain = chainWithSigs();
        const result = verifyEvidence(chain.records, [
            row("sigA", true),
            row("sigB", true),
        ]);
        // The genesis record has tx_sig null and must not demand evidence.
        expect(result.missing_sigs).toHaveLength(0);
    });
});
