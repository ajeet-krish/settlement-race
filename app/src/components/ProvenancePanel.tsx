import { useEffect, useMemo, useState } from "react";
import type { RaceEvent } from "../engine/scenarioEngine";
import type { VerifyResult } from "../lib/provenance";
import { verifyRecords } from "../lib/provenance";
import { raceModeCopy, type RaceMode } from "../lib/raceSource";
import type { ChainStatus } from "./race/raceTypes";
import ChainTable from "./provenance/ChainTable";
import EvidenceCard from "./provenance/EvidenceCard";
import TamperCard from "./provenance/TamperCard";
import VerifyCard from "./provenance/VerifyCard";
import { chainRows, recordsFromEvents } from "./provenance/provenanceView";
import "../styles/provenance.css";

export interface ProvenancePanelProps {
    /**
     * Events accumulated by the race tab, in stream order. Each event
     * carries its provenance record, so the race view stays the single
     * source and this panel derives its rows from the same stream.
     */
    events?: readonly RaceEvent[];
    /** Ledger behind the chain: live devnet or the offline demo. */
    mode?: RaceMode;
    /** Anchor verdict of the last run, as the race pill shows it. */
    chainStatus?: ChainStatus;
}

/**
 * Provenance view: inspect and verify the run's hash chain, see the
 * anchor comparison the run already performed, watch the tamper demo
 * fire on a copy, and read devnet transaction evidence for the
 * signatures in live mode. Presentation state only (the verify result
 * and an expanded row); the chain itself always derives from the
 * events prop, and the verify result resets whenever a new stream
 * replaces the old one so a stale verdict never describes a
 * different run.
 */
export default function ProvenancePanel({
    events = [],
    mode = "live",
    chainStatus = "PENDING",
}: ProvenancePanelProps) {
    const rows = useMemo(() => chainRows(events), [events]);
    const records = useMemo(() => recordsFromEvents(events), [events]);
    const [verdict, setVerdict] = useState<VerifyResult | null>(null);

    // A changed stream means a new run (or a mode switch) replaced the
    // chain the last verdict described: start over.
    useEffect(() => {
        setVerdict(null);
    }, [events]);

    function handleVerify(): void {
        setVerdict(verifyRecords(records));
    }

    return (
        <div className="prov">
            <header className="prov-head">
                <div>
                    <h2 className="panel-heading">Provenance</h2>
                    <p className="prov-lede">
                        Every step of the last run, hash chained from genesis
                        and anchored on chain. Recompute the links, inspect the
                        evidence, and watch tamper detection fire on a copy.
                    </p>
                </div>
                <p className={`mode-badge mode-badge-${mode}`}>
                    {raceModeCopy(mode).badge}
                </p>
            </header>

            {rows.length === 0 ? (
                <div className="prov-empty" role="note">
                    <p className="prov-empty-title">
                        Run a scenario to generate provenance
                    </p>
                    <p className="prov-empty-body">
                        Open the Race tab, pick a scenario, and press Run. Each
                        step appends one record here, in chain order.
                    </p>
                </div>
            ) : (
                <>
                    <VerifyCard
                        records={records}
                        verdict={verdict}
                        chainStatus={chainStatus}
                        onVerify={handleVerify}
                    />
                    <ChainTable
                        rows={rows}
                        brokenAt={
                            verdict !== null && !verdict.valid
                                ? verdict.broken_at
                                : null
                        }
                    />
                    <TamperCard records={records} />
                    <EvidenceCard mode={mode} records={records} />
                </>
            )}
        </div>
    );
}
