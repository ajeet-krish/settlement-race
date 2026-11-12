import type { ChainStatus } from "./raceTypes";

interface ChainStatusIndicatorProps {
    /** Verification state of the provenance chain head. */
    status: ChainStatus;
}

/**
 * Small pill reporting the provenance chain's verification state. The
 * word carries the meaning, so colour never is the only signal. The value
 * is a prop: wiring lands the validator in a later slice.
 */
export default function ChainStatusIndicator({
    status,
}: ChainStatusIndicatorProps) {
    return (
        <p className={`chain-pill chain-pill-${status.toLowerCase()}`}>
            <span className="chain-dot" aria-hidden="true" />
            chain {status.toLowerCase()}
        </p>
    );
}
