import { InlineCites } from "./Citations";
import { COMPARISON_ROWS, RAILS, TABLE_CAPTION } from "./learnContent";

/**
 * Payments comparison: three rails across six dimensions, rendered as a
 * real table for screen readers. The explicit roles keep that table
 * semantics intact when the stylesheet flattens the table into stacked
 * labelled blocks below 48rem, where four prose columns cannot share a
 * phone without scrolling sideways. In the stacked form each rail value
 * carries its own rail label, which the wide layout hides in favour of
 * the column headers, so no value is ever read without its rail.
 */
export default function ComparisonTable() {
    return (
        <div className="learn-table-block">
            <p className="learn-table-caption" id="learn-table-caption">
                {TABLE_CAPTION}
            </p>
            <div className="learn-table-wrap">
                <table
                    className="learn-table"
                    role="table"
                    aria-labelledby="learn-table-caption"
                >
                    <thead role="rowgroup">
                        <tr role="row">
                            <th
                                scope="col"
                                className="learn-dim"
                                role="columnheader"
                            >
                                Dimension
                            </th>
                            {RAILS.map((rail) => (
                                <th
                                    scope="col"
                                    key={rail.key}
                                    role="columnheader"
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
                    <tbody role="rowgroup">
                        {COMPARISON_ROWS.map((row) => (
                            <tr key={row.label} role="row">
                                <th
                                    scope="row"
                                    className="learn-dim"
                                    role="rowheader"
                                >
                                    {row.label}
                                </th>
                                {RAILS.map((rail) => (
                                    <td
                                        key={rail.key}
                                        role="cell"
                                        className="learn-cell"
                                    >
                                        <span className="learn-cell-label">
                                            {rail.label}
                                        </span>
                                        <InlineCites text={row.cells[rail.key]} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
