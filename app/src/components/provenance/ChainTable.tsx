import { Fragment, useState } from "react";
import CopyButton from "./CopyButton";
import { formatVirtualTs, shortHash, type ChainRow } from "./provenanceView";

export interface ChainTableProps {
    /** Rows in chain order, derived from the run's events. */
    rows: readonly ChainRow[];
    /**
     * Seq of the first broken link from the last verify, or null when
     * the chain verified or was never checked. The row at that seq is
     * marked as the bad link.
     */
    brokenAt: number | null;
}

function padSeq(seq: number): string {
    return String(seq).padStart(2, "0");
}

function laneAbbrev(lane: string): string {
    return lane === "SEQUENTIAL" ? "SEQ" : "ATM";
}

/**
 * The chain table: one row per record with sequence, virtual stamp,
 * lane, event, actor, short signature and hash forms, and a details
 * toggle that expands the full data payload as pretty JSON plus the
 * full hashes. The first broken link is marked on its row and named in
 * a visually hidden span, so the state survives both color blindness
 * and a screen reader. Below 64rem the actor and hash columns fold
 * into that detail row, and below 48rem the stamp and signature fold
 * with them, so the row keeps its identity columns and nothing is
 * dropped: every folded field is one tap away in the expanded record.
 */
export default function ChainTable({ rows, brokenAt }: ChainTableProps) {
    const [openSeq, setOpenSeq] = useState<number | null>(null);

    return (
        <section className="prov-card" aria-labelledby="prov-chain-title">
            <h3 className="prov-title" id="prov-chain-title">
                Chain records
            </h3>
            <p className="prov-table-caption" id="prov-chain-caption">
                {rows.length} {rows.length === 1 ? "record" : "records"}, oldest
                first. Open a row for the full payload and hashes.
            </p>
            <div className="prov-table-wrap">
                <table className="prov-table">
                    <thead>
                        <tr>
                            <th scope="col">Seq</th>
                            <th scope="col" className="prov-col-ts">
                                Virtual ts
                            </th>
                            <th scope="col">Lane</th>
                            <th scope="col">Event</th>
                            <th scope="col" className="prov-col-actor">
                                Actor
                            </th>
                            <th scope="col" className="prov-col-sig">
                                Tx sig
                            </th>
                            <th scope="col" className="prov-col-prev">
                                Prev hash
                            </th>
                            <th scope="col" className="prov-col-hash">
                                Hash
                            </th>
                            <th scope="col">
                                <span className="prov-visually-hidden">
                                    Record detail
                                </span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const broken =
                                brokenAt !== null && row.seq === brokenAt;
                            const open = openSeq === row.seq;
                            const detailId = `prov-detail-${row.seq}`;
                            return (
                                <Fragment key={row.seq}>
                                    <tr
                                        className={`prov-row${
                                            broken ? " prov-row-broken" : ""
                                        }`}
                                    >
                                        <td className="prov-seq">
                                            {padSeq(row.seq)}
                                            {broken ? (
                                                <span className="prov-visually-hidden">
                                                    {" "}
                                                    broken link
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="prov-ts prov-col-ts">
                                            {formatVirtualTs(row.virtual_ts_ms)}{" "}
                                            s
                                        </td>
                                        <td>
                                            <span
                                                className={`prov-lane prov-lane-${row.lane.toLowerCase()}`}
                                            >
                                                {laneAbbrev(row.lane)}
                                            </span>
                                        </td>
                                        <td className="prov-event">
                                            {row.event}
                                        </td>
                                        <td className="prov-actor prov-col-actor">
                                            {row.actor}
                                        </td>
                                        <td className="prov-sig prov-col-sig">
                                            {row.tx_sig !== null ? (
                                                <span className="prov-hash-cell">
                                                    <span className="prov-mono">
                                                        {shortHash(row.tx_sig)}
                                                    </span>
                                                    <CopyButton
                                                        value={row.tx_sig}
                                                        noun={`signature at seq ${row.seq}`}
                                                    />
                                                </span>
                                            ) : (
                                                <span className="prov-none">
                                                    none
                                                </span>
                                            )}
                                        </td>
                                        <td className="prov-mono prov-col-prev">
                                            {shortHash(row.prev_hash)}
                                        </td>
                                        <td className="prov-mono prov-col-hash">
                                            {shortHash(row.hash)}
                                        </td>
                                        <td className="prov-toggle-cell">
                                            <button
                                                type="button"
                                                className="prov-toggle"
                                                aria-expanded={open}
                                                aria-controls={detailId}
                                                onClick={() =>
                                                    setOpenSeq(
                                                        open ? null : row.seq,
                                                    )
                                                }
                                            >
                                                {open ? "Hide" : "Details"}
                                            </button>
                                        </td>
                                    </tr>
                                    {open ? (
                                        <tr
                                            className="prov-detail-row"
                                            id={detailId}
                                        >
                                            <td colSpan={9}>
                                                <div className="prov-detail">
                                                    <div className="prov-detail-block">
                                                        <p className="prov-detail-label">
                                                            Data payload
                                                        </p>
                                                        <pre className="prov-json">
                                                            {JSON.stringify(
                                                                row.data,
                                                                null,
                                                                2,
                                                            )}
                                                        </pre>
                                                    </div>
                                                    <div className="prov-detail-block">
                                                        <p className="prov-detail-label">
                                                            Full record link
                                                        </p>
                                                        <dl className="prov-detail-list">
                                                            <dt>
                                                                Virtual stamp
                                                            </dt>
                                                            <dd>
                                                                <span className="prov-mono-full">
                                                                    {
                                                                        row.virtual_ts_ms
                                                                    }{" "}
                                                                    ms
                                                                </span>
                                                            </dd>
                                                            <dt>Actor</dt>
                                                            <dd>
                                                                <span className="prov-mono-full">
                                                                    {row.actor}
                                                                </span>
                                                            </dd>
                                                            <dt>
                                                                Previous hash
                                                            </dt>
                                                            <dd>
                                                                <span className="prov-mono-full">
                                                                    {
                                                                        row.prev_hash
                                                                    }
                                                                </span>
                                                                <CopyButton
                                                                    value={
                                                                        row.prev_hash
                                                                    }
                                                                    noun={`previous hash at seq ${row.seq}`}
                                                                />
                                                            </dd>
                                                            <dt>
                                                                Record hash
                                                            </dt>
                                                            <dd>
                                                                <span className="prov-mono-full">
                                                                    {row.hash}
                                                                </span>
                                                                <CopyButton
                                                                    value={
                                                                        row.hash
                                                                    }
                                                                    noun={`record hash at seq ${row.seq}`}
                                                                />
                                                            </dd>
                                                            <dt>
                                                                Transaction
                                                                signature
                                                            </dt>
                                                            <dd>
                                                                {row.tx_sig !==
                                                                null ? (
                                                                    <>
                                                                        <span className="prov-mono-full">
                                                                            {
                                                                                row.tx_sig
                                                                            }
                                                                        </span>
                                                                        <CopyButton
                                                                            value={
                                                                                row.tx_sig
                                                                            }
                                                                            noun={`full signature at seq ${row.seq}`}
                                                                        />
                                                                    </>
                                                                ) : (
                                                                    <span className="prov-none">
                                                                        none, this
                                                                        step was
                                                                        off chain
                                                                    </span>
                                                                )}
                                                            </dd>
                                                        </dl>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
