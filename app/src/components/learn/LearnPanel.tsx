import type { ReactNode } from "react";
import { InlineCites, SourceList } from "./Citations";
import ClsLimitsBox from "./ClsLimitsBox";
import ComparisonTable from "./ComparisonTable";
import {
    ATOMIC_COSTS,
    ATOMIC_GAINS,
    ATOMIC_PARAS,
    CLS_FIGURES,
    CLS_PARAS,
    FRAMING,
    HOOK,
    LEARN_SECTIONS,
    PULL_QUOTE,
    RISK_PARAS,
    TRUST_PARAS,
} from "./learnContent";
import "../../styles/learn.css";

/** One paragraph per string, citations rendered inline. */
function prose(texts: readonly string[]): ReactNode {
    return (
        <div className="learn-prose">
            {texts.map((text, index) => (
                <p className="learn-para" key={index}>
                    <InlineCites text={text} />
                </p>
            ))}
        </div>
    );
}

/**
 * Body blocks per section. The honest limits section is special: its
 * box renders the section heading itself, so the wrapper skips the
 * shared eyebrow and heading and points aria-labelledby at the box.
 */
function renderSectionBody(id: string): ReactNode {
    switch (id) {
        case "risk-window":
            return (
                <>
                    {prose(RISK_PARAS)}
                    <blockquote className="learn-pull">
                        {PULL_QUOTE}
                    </blockquote>
                </>
            );
        case "what-cls-does":
            return (
                <>
                    {prose(CLS_PARAS)}
                    <div className="learn-figures">
                        {CLS_FIGURES.map((figure) => (
                            <figure className="learn-figure" key={figure.value}>
                                <p className="learn-figure-value">
                                    {figure.value}
                                </p>
                                <figcaption className="learn-figure-label">
                                    {figure.label}
                                </figcaption>
                                <p className="learn-figure-source">
                                    <InlineCites text={figure.source} />
                                </p>
                                <p className="learn-figure-confidence">
                                    {figure.confidence}
                                </p>
                            </figure>
                        ))}
                    </div>
                </>
            );
        case "honest-limits":
            return <ClsLimitsBox />;
        case "atomic-settlement":
            return (
                <>
                    {prose(ATOMIC_PARAS)}
                    <div className="learn-split">
                        <div className="learn-col learn-col-gives">
                            <h4 className="learn-col-title">
                                What the chain gives you
                            </h4>
                            <ul className="learn-col-list">
                                {ATOMIC_GAINS.map((item) => (
                                    <li className="learn-col-item" key={item}>
                                        <InlineCites text={item} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="learn-col learn-col-costs">
                            <h4 className="learn-col-title">
                                What it costs you
                            </h4>
                            <ul className="learn-col-list">
                                {ATOMIC_COSTS.map((item) => (
                                    <li className="learn-col-item" key={item}>
                                        <InlineCites text={item} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </>
            );
        case "comparison":
            return <ComparisonTable />;
        case "trust":
            return (
                <div className="learn-trust">
                    <p className="learn-trust-title">Trust anchors</p>
                    {TRUST_PARAS.map((text, index) => (
                        <p className="learn-trust-body" key={index}>
                            <InlineCites text={text} />
                        </p>
                    ))}
                </div>
            );
        case "sources":
            return <SourceList />;
        default:
            return null;
    }
}

/**
 * Theory panel: an opening thesis, a left "On this page" table of
 * contents, then the narrative sections (risk window, CLS, the honesty
 * box, atomic settlement, the rail comparison, the trust note, and
 * sources) in the main column beside it. Pure presentational copy from
 * learnContent, no engine or account state, so the whole view is static
 * and testable as data.
 */
export default function LearnPanel() {
    return (
        <div className="learn">
            <header className="learn-head">
                <p className="learn-eyebrow">Settlement theory</p>
                <h2 className="learn-thesis">{HOOK}</h2>
                <p className="learn-framing">{FRAMING}</p>
                <div className="learn-keyline" aria-hidden="true">
                    <span className="learn-keyline-amber" />
                    <span className="learn-keyline-teal" />
                </div>
            </header>

            <div className="learn-layout">
                <nav
                    className="learn-toc"
                    aria-labelledby="learn-toc-title"
                >
                    <div className="learn-toc-inner">
                        <p
                            className="learn-toc-title"
                            id="learn-toc-title"
                        >
                            On this page
                        </p>
                        <ul className="learn-toc-list">
                            {LEARN_SECTIONS.map((section) => (
                                <li key={section.id}>
                                    <a
                                        className="learn-toc-link"
                                        href={`#${section.id}`}
                                    >
                                        {section.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </nav>

                <div className="learn-main">
                    {LEARN_SECTIONS.map((section) => {
                        const boxed = section.id === "honest-limits";
                        return (
                            <section
                                key={section.id}
                                id={section.id}
                                className="learn-section"
                                aria-labelledby={
                                    boxed
                                        ? "honest-limits-title"
                                        : `${section.id}-title`
                                }
                            >
                                {boxed ? null : (
                                    <>
                                        <p
                                            className={`learn-sec-eyebrow learn-sec-eyebrow-${section.tone}`}
                                        >
                                            {section.eyebrow}
                                        </p>
                                        <h3
                                            className="learn-sec-title"
                                            id={`${section.id}-title`}
                                        >
                                            {section.title}
                                        </h3>
                                    </>
                                )}
                                {renderSectionBody(section.id)}
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
