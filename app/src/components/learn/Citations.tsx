import { Fragment } from "react";
import type { ReactNode } from "react";
import { CITATION_ENTRIES, splitCitations } from "./learnContent";

interface InlineCitesProps {
    /** Copy string possibly containing [n] citation tokens. */
    text: string;
}

/**
 * Renders one copy string, turning [n] tokens into superscript links
 * that jump to the matching entry in the sources list. Consecutive
 * tokens stay grouped as [1][2] inside one superscript.
 */
export function InlineCites({ text }: InlineCitesProps): ReactNode {
    return (
        <>
            {splitCitations(text).map((segment, index) => {
                if (segment.kind === "text") {
                    return (
                        <Fragment key={`t${index}`}>{segment.value}</Fragment>
                    );
                }
                return (
                    <sup className="learn-cite" key={`c${index}`}>
                        {segment.nums.map((num) => (
                            <a key={num} href={`#cite-${num}`}>
                                {`[${num}]`}
                            </a>
                        ))}
                    </sup>
                );
            })}
        </>
    );
}

/**
 * The sources list: every citation used on this page, numbered to
 * match docs/research.md section 10, with the original URL.
 */
export function SourceList(): ReactNode {
    return (
        <ul className="learn-sources">
            {CITATION_ENTRIES.map(([num, citation]) => (
                <li className="learn-source" key={num} id={`cite-${num}`}>
                    <span className="learn-source-num">{`[${num}]`}</span>
                    <span className="learn-source-label">{citation.label}</span>
                    <a
                        className="learn-source-url"
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {citation.url}
                    </a>
                </li>
            ))}
        </ul>
    );
}
