import { useEffect, useRef, useState } from "react";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { fetchEvidence } from "../../lib/evidence";
import type { EvidenceRecord } from "../../lib/evidence";
import type { ProvenanceRecord } from "../../lib/provenance";
import type { RaceMode } from "../../lib/raceSource";
import CopyButton from "./CopyButton";
import {
    EVIDENCE_SIG_CAP,
    checkEvidence,
    describeEvidenceFailure,
    distinctSigs,
    evidencePhase,
    evidenceReasonLabel,
    selectEvidenceSigs,
    shortHash,
    summarizeEvidence,
} from "./provenanceView";

export interface EvidenceCardProps {
    /** Ledger behind the chain: live devnet or the offline demo. */
    mode: RaceMode;
    /** Records of the current chain, in chain order. */
    records: readonly ProvenanceRecord[];
}

/** Yes or no cell copy, spelled out so color is never the only signal. */
function flagCell(ok: boolean): string {
    return ok ? "yes" : "no";
}

/**
 * Devnet transaction evidence: pick the first few distinct signatures
 * from the chain, read each one from RPC through fetchEvidence (which
 * validates base58 shape, caps batches, and retries rate limits
 * internally), and render what was found. Offline mode never fetches:
 * the mock ledger's signatures no cluster has seen, and the panel says
 * so plainly. A failure outside fetchEvidence's contract surfaces as a
 * typed RpcError line instead of vanishing. State resets whenever the
 * chain changes, so a table never describes a replaced run.
 */
export default function EvidenceCard({ mode, records }: EvidenceCardProps) {
    const [rows, setRows] = useState<EvidenceRecord[] | null>(null);
    const [fetching, setFetching] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const connectionRef = useRef<Connection | null>(null);
    // Bumped whenever the chain changes so an in flight fetch from a
    // replaced run cannot write its rows into the new chain's view.
    const tokenRef = useRef(0);

    useEffect(() => {
        tokenRef.current += 1;
        setRows(null);
        setFailure(null);
        setFetching(false);
    }, [records]);

    const phase = evidencePhase(mode, records);
    const sigs = selectEvidenceSigs(records);
    const totalSigs = distinctSigs(records).length;

    // One devnet connection, created on first use and reused after:
    // evidence reads are plain account lookups and never touch the demo
    // accounts or sign anything.
    function getConnection(): Connection {
        if (connectionRef.current === null) {
            connectionRef.current = new Connection(
                clusterApiUrl("devnet"),
                "confirmed",
            );
        }
        return connectionRef.current;
    }

    function handleFetch(): void {
        const token = tokenRef.current;
        setFetching(true);
        setFailure(null);
        const succeed = (result: EvidenceRecord[]): void => {
            if (token !== tokenRef.current) {
                return;
            }
            setRows(result);
            setFailure(null);
            setFetching(false);
        };
        const fail = (err: unknown): void => {
            if (token !== tokenRef.current) {
                return;
            }
            setRows(null);
            setFailure(describeEvidenceFailure(err));
            setFetching(false);
        };
        try {
            const connection = getConnection();
            void fetchEvidence(connection, sigs).then(succeed, fail);
        } catch (err) {
            fail(err);
        }
    }

    if (phase === "offline") {
        return (
            <section
                className="prov-card"
                aria-labelledby="prov-evidence-title"
            >
                <h3 className="prov-title" id="prov-evidence-title">
                    Transaction evidence
                </h3>
                <p className="prov-slip prov-slip-offline" role="note">
                    No on-chain evidence in offline demo. Offline runs sign
                    nothing: the mock ledger records its own signatures, so no
                    cluster has ever seen them.
                </p>
            </section>
        );
    }

    if (phase === "empty") {
        return (
            <section
                className="prov-card"
                aria-labelledby="prov-evidence-title"
            >
                <h3 className="prov-title" id="prov-evidence-title">
                    Transaction evidence
                </h3>
                <p className="prov-slip prov-slip-idle" role="note">
                    This chain carries no transaction signatures to check.
                </p>
            </section>
        );
    }

    const summary = rows !== null ? summarizeEvidence(rows) : null;
    const checked = rows !== null ? checkEvidence(records, rows) : null;

    return (
        <section className="prov-card" aria-labelledby="prov-evidence-title">
            <div className="prov-verify-head">
                <h3 className="prov-title" id="prov-evidence-title">
                    Transaction evidence
                </h3>
                <button
                    type="button"
                    className="prov-fetch-btn"
                    onClick={handleFetch}
                    disabled={fetching}
                >
                    {fetching
                        ? "Fetching..."
                        : rows !== null
                          ? "Fetch again"
                          : "Fetch devnet evidence"}
                </button>
            </div>
            <p className="prov-lede-sm">
                Reads up to {EVIDENCE_SIG_CAP} signatures from the chain, one
                RPC call each: {sigs.length} of {totalSigs} distinct{" "}
                {totalSigs === 1 ? "signature" : "signatures"} in this run.
            </p>

            {failure !== null ? (
                <p className="prov-slip prov-slip-fail" role="alert">
                    {failure}
                </p>
            ) : null}

            {rows !== null ? (
                <div role="status">
                    <div className="prov-table-wrap">
                        <table
                            className="prov-table prov-evidence-table"
                            role="table"
                            aria-label="Devnet evidence rows"
                        >
                            <thead role="rowgroup">
                                <tr role="row">
                                    <th scope="col" role="columnheader">
                                        Signature
                                    </th>
                                    <th scope="col" role="columnheader">
                                        Found
                                    </th>
                                    <th scope="col" role="columnheader">
                                        Our program
                                    </th>
                                    <th scope="col" role="columnheader">
                                        Success
                                    </th>
                                    <th scope="col" role="columnheader">
                                        Detail
                                    </th>
                                </tr>
                            </thead>
                            <tbody role="rowgroup">
                                {rows.map((row) => (
                                    <tr key={row.tx_sig} role="row">
                                        <td
                                            className="prov-sig"
                                            role="cell"
                                        >
                                            <span className="prov-hash-cell">
                                                <span className="prov-mono">
                                                    {shortHash(row.tx_sig)}
                                                </span>
                                                <CopyButton
                                                    value={row.tx_sig}
                                                    noun="fetched signature"
                                                />
                                            </span>
                                        </td>
                                        <td
                                            className={`prov-flag prov-flag-${row.fetched_ok ? "yes" : "no"}`}
                                            role="cell"
                                            data-label="Found"
                                        >
                                            {flagCell(row.fetched_ok)}
                                        </td>
                                        <td
                                            className={`prov-flag prov-flag-${row.program_id_match ? "yes" : "no"}`}
                                            role="cell"
                                            data-label="Our program"
                                        >
                                            {flagCell(row.program_id_match)}
                                        </td>
                                        <td
                                            className={`prov-flag prov-flag-${row.success ? "yes" : "no"}`}
                                            role="cell"
                                            data-label="Success"
                                        >
                                            {flagCell(row.success)}
                                        </td>
                                        <td
                                            className="prov-flag-detail"
                                            role="cell"
                                            data-label="Detail"
                                        >
                                            {row.reason !== undefined
                                                ? evidenceReasonLabel(
                                                      row.reason,
                                                  )
                                                : ""}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {summary !== null ? (
                        <p className="prov-evidence-summary">
                            {summary.fetched} of {summary.total} found,{" "}
                            {summary.program_match} with our program id,{" "}
                            {summary.succeeded} succeeded.
                        </p>
                    ) : null}

                    {checked !== null ? (
                        <p
                            className={`prov-evidence-check${
                                checked.valid
                                    ? " prov-evidence-check-ok"
                                    : " prov-evidence-check-bad"
                            }`}
                        >
                            {checked.valid
                                ? "Evidence check: PASS, every fetched signature exists on chain."
                                : `Evidence check: FAIL, ${checked.missing_sigs.length} signature${checked.missing_sigs.length === 1 ? "" : "s"} missing.`}
                        </p>
                    ) : null}

                    <p className="prov-evidence-note">
                        Evidence passes when every fetched signature exists on
                        chain. Program id and success are reported per row, so a
                        failed or foreign transaction stays visible.
                    </p>
                </div>
            ) : fetching ? (
                <p className="prov-slip prov-slip-idle" role="status">
                    Reading devnet, one signature at a time...
                </p>
            ) : (
                <p className="prov-slip prov-slip-idle" role="note">
                    Fetch evidence to read these signatures from devnet.
                </p>
            )}
        </section>
    );
}
