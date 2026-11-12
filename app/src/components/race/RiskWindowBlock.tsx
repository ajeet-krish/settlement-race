import { fmt } from "../../lib/money";
import { formatVirtualSeconds, type RiskWindow } from "./raceTiming";

interface RiskWindowBlockProps {
    /** Window derived from the sequential lane's stream. */
    window: RiskWindow;
    /** Current displayed virtual time, for the open exposure elapsed. */
    displayMs: bigint;
}

/**
 * The signature block of the race view: a hatched amber interval that
 * hangs under the leg 1 marker and spans exactly the exposure window.
 * While open it counts elapsed virtual time at risk; once closed it
 * reports the window's duration and flags a late closing payment.
 * A "never" window is rendered by the lane instead, outside the list.
 */
export default function RiskWindowBlock({
    window,
    displayMs,
}: RiskWindowBlockProps) {
    if (window.status === "never") {
        return null;
    }

    if (window.status === "open") {
        const openAt = window.open_at;
        const elapsed =
            openAt === null || displayMs <= openAt ? 0n : displayMs - openAt;
        const amount = window.amount_label_input;
        return (
            <div className="risk-window risk-window-open">
                <p className="risk-eyebrow">Risk window</p>
                <p className="risk-copy">
                    {amount === null ? (
                        <>
                            Exposure open: awaiting event,{" "}
                            {formatVirtualSeconds(elapsed)} s (virtual)
                        </>
                    ) : (
                        <>
                            Exposure open: {fmt(amount, "USD")} at risk for{" "}
                            {formatVirtualSeconds(elapsed)} s (virtual)
                        </>
                    )}
                </p>
            </div>
        );
    }

    const duration = window.duration_ms;
    return (
        <div className="risk-window risk-window-closed">
            <p className="risk-eyebrow">Risk window</p>
            <p className="risk-copy">
                Exposure closed:{" "}
                {duration === null
                    ? "awaiting event"
                    : `${formatVirtualSeconds(duration)} s`}
                {window.late ? (
                    <span className="risk-late">Paid late</span>
                ) : null}
            </p>
        </div>
    );
}
