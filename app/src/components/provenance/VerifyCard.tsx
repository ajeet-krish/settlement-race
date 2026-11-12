import type { ProvenanceRecord, VerifyResult } from "../../lib/provenance";
import type { ChainStatus } from "../race/raceTypes";
import CopyButton from "./CopyButton";
import {
    localHead,
    shortHash,
    summarizeAnchor,
    verifyVerdict,
    type AnchorCell,
} from "./provenanceView";

export interface VerifyCardProps {
    /** Records of the current chain, in chain order. */
    records: readonly ProvenanceRecord[];
    /** Result of the last Verify press, or null before the first run. */
    verdict: VerifyResult | null;
    /** Anchor verdict the run pipeline reported (chain_ok mapped). */
    chainStatus: ChainStatus;
    /** Recompute every link over the current records. */
    onVerify: () => void;
}

/** Sentence case cell copy for one anchor cell. */
const CELL_LABEL: Readonly<Record<AnchorCell, string>> = {
    match: "match",
    unknown: "unknown",
    unchecked: "not checked",
};

/**
 * Verify section: the button that recomputes every hash link, the
 * verdict slab as the panel's signature moment (teal VALID, clay
 * BROKEN), and the anchor comparison the run already performed. The
 * anchor cells only claim what chain_ok can support: a valid run means
 * the head and the count both matched, a broken run cannot say which
 * check failed, and a pending run checked nothing.
 */
export default function VerifyCard({
    records,
    verdict,
    chainStatus,
    onVerify,
}: VerifyCardProps) {
    const verdictView =
        verdict === null
            ? {
                  label: "NOT VERIFIED",
                  tone: "idle",
                  detail: "Press Verify to recompute every hash link from genesis.",
              }
            : (() => {
                  const mapped = verifyVerdict(verdict, records);
                  return {
                      label: mapped.label,
                      tone: mapped.label === "VALID" ? "valid" : "broken",
                      detail: mapped.detail,
                  };
              })();

    const anchor = summarizeAnchor(chainStatus, verdict);
    const head = localHead(records);

    return (
        <section className="prov-card" aria-labelledby="prov-verify-title">
            <div className="prov-verify-head">
                <h3 className="prov-title" id="prov-verify-title">
                    Verify the chain
                </h3>
                <button
                    type="button"
                    className="prov-verify-btn"
                    onClick={onVerify}
                    disabled={records.length === 0}
                >
                    Verify
                </button>
            </div>

            <div
                className={`prov-verdict prov-verdict-${verdictView.tone}`}
                role="status"
            >
                <span className="prov-verdict-word">{verdictView.label}</span>
                <span className="prov-verdict-detail">
                    {verdictView.detail}
                </span>
            </div>

            <div className="prov-anchor">
                <p
                    className={`prov-anchor-label prov-anchor-label-${anchor.status.toLowerCase()}`}
                >
                    {anchor.label}
                </p>
                <dl className="prov-anchor-grid">
                    <dt>Head match</dt>
                    <dd className={`prov-cell prov-cell-${anchor.head_match}`}>
                        {CELL_LABEL[anchor.head_match]}
                    </dd>
                    <dt>Event count match</dt>
                    <dd className={`prov-cell prov-cell-${anchor.count_match}`}>
                        {CELL_LABEL[anchor.count_match]}
                    </dd>
                    <dt>Local head</dt>
                    <dd className="prov-anchor-value">
                        <span className="prov-mono">{shortHash(head)}</span>
                        <CopyButton value={head} noun="local chain head" />
                    </dd>
                    <dt>Event count</dt>
                    <dd className="prov-anchor-value">
                        {records.length}{" "}
                        {records.length === 1 ? "record" : "records"}
                    </dd>
                </dl>
                <p className="prov-anchor-note">{anchor.note}</p>
            </div>
        </section>
    );
}
