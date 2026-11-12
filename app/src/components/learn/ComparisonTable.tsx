import { InlineCites } from "./Citations";
import { COMPARISON_ROWS, RAILS, TABLE_CAPTION } from "./learnContent";

/**
 * Payments comparison: three rails across six dimensions, rendered as
 * a real table for screen readers. The wrapper is a labelled, focusable
 * scroll region so the wide table stays reachable on narrow screens
 * with a visible affordance instead of silently clipping.
 */
export default function ComparisonTable() {
    return (
        <div className="learn-table-block">
            <p className="learn-table-caption" id="learn-table-caption">
                {TABLE_CAPTION}
            </p>
            <div
                className="learn-table-wrap"
                role="region"
                aria-labelledby="learn-table-caption"
                tabIndex={0}
            >
                <table className="learn-table">
                    <thead>
                        <tr>
                            <th scope="col" className="learn-dim">
                                Dimension
                            </th>
                            {RAILS.map((rail) => (
                                <th
                                    scope="col"
                                    key={rail.key}
                                    className={`learn-rail-head learn-rail-head-${rail.key}`}
                                >
                                    {rail.label}
                                    <span className="learn-rail-sub">
                                        {rail.sub}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {COMPARISON_ROWS.map((row) => (
                            <tr key={row.label}>
                                <th scope="row" className="learn-dim">
                                    {row.label}
                                </th>
                                <td className="learn-cell">
                                    <InlineCites text={row.cells.wire} />
                                </td>
                                <td className="learn-cell">
                                    <InlineCites text={row.cells.cls} />
                                </td>
                                <td className="learn-cell">
                                    <InlineCites text={row.cells.stable} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="learn-table-hint">
                Scroll sideways to compare all three rails.
            </p>
        </div>
    );
}
