import type { ReactNode } from "react";
import type { RaceEvent } from "../../engine/scenarioEngine";
import { fmt, type Currency } from "../../lib/money";
import { partyBalances } from "./raceBalances";

interface BalancePanelProps {
    /** Full event stream; balances derive from the sequential lane. */
    events: readonly RaceEvent[];
}

/**
 * Party A and Party B tUSD and tCAD deltas with integer cents math. The
 * column headers carry the currency, so cells show only the signed
 * grouped amount; a value that cannot be derived yet reads "awaiting
 * event" instead of guessing. A defaulted run adds the quantified loss
 * block: party A's released leg 1 USD, gone.
 */
export default function BalancePanel({ events }: BalancePanelProps) {
    const balances = partyBalances(events);

    return (
        <section className="balances" aria-label="Party balances">
            <h3 className="balances-title">Balances</h3>
            <p className="balances-note">Sequential path, tokenized units</p>
            <table className="balances-table">
                <thead>
                    <tr>
                        <th className="balances-head balances-head-start">
                            Party
                        </th>
                        <th className="balances-head">tUSD</th>
                        <th className="balances-head">tCAD</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th scope="row" className="balances-party">
                            Party A
                        </th>
                        <td className="balances-cell">
                            {amount(balances.party_a.t_usd, "USD")}
                        </td>
                        <td className="balances-cell">
                            {amount(balances.party_a.t_cad, "CAD")}
                        </td>
                    </tr>
                    <tr>
                        <th scope="row" className="balances-party">
                            Party B
                        </th>
                        <td className="balances-cell">
                            {amount(balances.party_b.t_usd, "USD")}
                        </td>
                        <td className="balances-cell">
                            {amount(balances.party_b.t_cad, "CAD")}
                        </td>
                    </tr>
                </tbody>
            </table>
            {balances.defaulted ? (
                <p className="loss-block">
                    <span className="loss-label">Loss</span>
                    {balances.loss_usd === null
                        ? "Party A's leg 1 loss: awaiting event."
                        : `Party A lost ${fmt(balances.loss_usd, "USD")} on the sequential path.`}
                </p>
            ) : null}
        </section>
    );
}

/** One table cell: the signed grouped amount, or the awaiting state. */
function amount(cents: bigint | null, ccy: Currency): ReactNode {
    if (cents === null) {
        return <span className="balances-await">awaiting event</span>;
    }
    const text = fmt(cents, ccy);
    const number = text.slice(0, text.lastIndexOf(" "));
    const sign = cents > 0n ? "+" : "";
    return (
        <span className="balances-amount">
            {sign}
            {number}
        </span>
    );
}
