import { InlineCites } from "./Citations";
import { CLS_LIMITS_BOX } from "./learnContent";

/**
 * The mandatory honesty box: a stamped exception slip that wears the
 * amber hatch on its top edge, because the risk it describes stays
 * open in this toy. Every mandated gap (netting, intraday credit,
 * central bank money, legal finality, simulated failure, toy scale,
 * play money) is listed as its own term so nothing is buried in prose.
 */
export default function ClsLimitsBox() {
    return (
        <section
            className="cls-box"
            aria-labelledby="honest-limits-title"
            id="cls-box"
        >
            <div className="cls-box-hatch" aria-hidden="true" />
            <p className="cls-box-eyebrow">{CLS_LIMITS_BOX.eyebrow}</p>
            <h3 className="cls-box-title" id="honest-limits-title">
                {CLS_LIMITS_BOX.title}
            </h3>
            <p className="cls-box-intro">
                <InlineCites text={CLS_LIMITS_BOX.intro} />
            </p>
            <dl className="cls-box-list">
                {CLS_LIMITS_BOX.items.map((item) => (
                    <div className="cls-box-item" key={item.term}>
                        <dt className="cls-box-term">{item.term}</dt>
                        <dd className="cls-box-body">
                            <InlineCites text={item.body} />
                        </dd>
                    </div>
                ))}
            </dl>
            <p className="cls-box-footer">
                <InlineCites text={CLS_LIMITS_BOX.footer} />
            </p>
        </section>
    );
}
