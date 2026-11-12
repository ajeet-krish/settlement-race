import type { RaceMode } from "../../lib/raceSource";
import type { ChainStatus } from "./raceTypes";

interface ChainStatusIndicatorProps {
    /** Verification state of the provenance chain head. */
    status: ChainStatus;
    /**
     * Which ledger the verdict came from: "live" (the default) verified
     * against the ChainHead account on devnet, "offline" against the
     * mock's in-memory anchor. Named so a mock verdict can never read
     * as on-chain evidence.
     */
    mode?: RaceMode;
}

/**
 * Small pill reporting the provenance chain's verification state. The
 * word carries the meaning, so colour never is the only signal. A
 * settled verdict names its evidence: devnet for a chain checked against
 * the ChainHead account, mock for an offline run against the in-memory
 * ledger. Pending has no evidence yet, so it stays unsuffixed.
 */
export default function ChainStatusIndicator({
    status,
    mode = "live",
}: ChainStatusIndicatorProps) {
    const evidence =
        status === "PENDING" ? null : mode === "offline" ? "mock" : "devnet";
    return (
        <p className={`chain-pill chain-pill-${status.toLowerCase()}`}>
            <span className="chain-dot" aria-hidden="true" />
            chain {status.toLowerCase()}{evidence !== null ? ` (${evidence})` : ""}
        </p>
    );
}
