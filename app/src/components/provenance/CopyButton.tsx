import { useEffect, useRef, useState } from "react";

export interface CopyButtonProps {
    /** Full value handed to the clipboard. */
    value: string;
    /** What is being copied, for the accessible name. */
    noun: string;
}

/** How long the Copied feedback stays on the button. */
const FEEDBACK_MS = 1600;

type CopyFeedback = "idle" | "copied" | "failed";

/**
 * Copy to clipboard with visible feedback: the label swaps to Copied
 * (or Copy failed when the clipboard is unavailable) and reverts on a
 * timer that is cleared on unmount. The feedback text lives in a
 * polite live region so the result is announced without moving focus.
 */
export default function CopyButton({ value, noun }: CopyButtonProps) {
    const [feedback, setFeedback] = useState<CopyFeedback>("idle");
    const timer = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (timer.current !== null) {
                window.clearTimeout(timer.current);
            }
        };
    }, []);

    function restartTimer(): void {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
        }
        timer.current = window.setTimeout(() => setFeedback("idle"), FEEDBACK_MS);
    }

    function showFeedback(result: Exclude<CopyFeedback, "idle">): void {
        setFeedback(result);
        restartTimer();
    }

    function handleClick(): void {
        try {
            const clipboard = navigator.clipboard;
            if (clipboard === undefined) {
                showFeedback("failed");
                return;
            }
            void clipboard.writeText(value).then(
                () => showFeedback("copied"),
                () => showFeedback("failed"),
            );
        } catch {
            showFeedback("failed");
        }
    }

    const text =
        feedback === "copied"
            ? "Copied"
            : feedback === "failed"
              ? "Copy failed"
              : "Copy";

    return (
        <button
            type="button"
            className={`prov-copy${
                feedback === "copied"
                    ? " prov-copy-ok"
                    : feedback === "failed"
                      ? " prov-copy-fail"
                      : ""
            }`}
            aria-label={`Copy ${noun}`}
            onClick={handleClick}
        >
            <span aria-live="polite">{text}</span>
        </button>
    );
}
