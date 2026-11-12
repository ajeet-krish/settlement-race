import { useEffect, useState } from "react";
import type { ProvenanceRecord } from "../../lib/provenance";
import { simulateTamper, type TamperDemo } from "./provenanceView";

export interface TamperCardProps {
    /** Records of the current chain, in chain order. */
    records: readonly ProvenanceRecord[];
}

function describeEdit(edit: TamperDemo["edit"]): string {
    const field = `data.${edit.key}`;
    if (edit.before === null) {
        return `${field} was added with the value ${String(edit.after)}`;
    }
    return `${field} changed from ${String(edit.before)} to ${String(edit.after)}`;
}

/**
 * Tamper demo: edit one field in a deep copy of the chain and verify
 * the copy, which breaks at the edited record while the original stays
 * untouched and still verifies. The demo result resets whenever the
 * chain changes, so a stale verdict never describes a run that has been
 * replaced. This is the teaching moment: hash chains turn a silent edit
 * into visible tamper evidence.
 */
export default function TamperCard({ records }: TamperCardProps) {
    const [demo, setDemo] = useState<TamperDemo | null>(null);

    useEffect(() => {
        setDemo(null);
    }, [records]);

    return (
        <section className="prov-card" aria-labelledby="prov-tamper-title">
            <h3 className="prov-title" id="prov-tamper-title">
                Tamper demo
            </h3>
            <p className="prov-lede-sm">
                Edit one field in a copy of the chain and watch verification
                stop at the edited record. The original chain is never touched.
            </p>
            <button
                type="button"
                className="prov-tamper-btn"
                onClick={() => setDemo(simulateTamper(records))}
                disabled={records.length === 0}
            >
                Simulate tamper
            </button>

            {demo !== null ? (
                <div className="prov-tamper-result" role="status">
                    <p className="prov-tamper-verdict">
                        Demo: BROKEN at seq{" "}
                        {demo.copy_result.broken_at ?? demo.edit.seq}
                    </p>
                    <p className="prov-tamper-edit">
                        The copy was edited before verifying:{" "}
                        {describeEdit(demo.edit)}.
                    </p>
                    <p className="prov-tamper-explain">
                        Verification recomputes the record hash, finds it no
                        longer matches the content, and stops at that record.
                        Every later link would fail the same way.
                    </p>
                    <p
                        className={`prov-tamper-original${
                            demo.original_result.valid
                                ? " prov-tamper-original-ok"
                                : " prov-tamper-original-bad"
                        }`}
                    >
                        Original chain:{" "}
                        {demo.original_result.valid
                            ? "VALID, unchanged by the demo."
                            : `BROKEN at seq ${demo.original_result.broken_at ?? 0} before the demo ran.`}
                    </p>
                </div>
            ) : null}
        </section>
    );
}
