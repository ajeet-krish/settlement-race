import type { LifecycleState, TradeTicket } from "../../lib/ticket";
import { fmt } from "../../lib/money";
import CopyButton from "../provenance/CopyButton";
import type { HashCheck, TicketView } from "./ticketView";
import { formatRateScaled, shortHash, truncateWallet } from "./ticketView";

export interface TicketHeaderCardProps {
    view: TicketView;
}

/** Chip colour role for the CURRENT lifecycle word. */
type LifeTone = "neutral" | "paying" | "settled" | "lost";

function lifeTone(state: LifecycleState): LifeTone {
    switch (state) {
        case "PAYING":
            return "paying";
        case "SETTLED":
            return "settled";
        case "DEFAULTED":
        case "FAILED":
            return "lost";
        default:
            return "neutral";
    }
}

/** Plain words for the side enum, kept mono for the ticket feel. */
function sideLabel(side: TradeTicket["side"]): string {
    return side === "BUY_CAD" ? "BUY CAD" : "SELL CAD";
}

/** The reconstruction honesty line under the hash, spelled out. */
const CHECK_COPY: Readonly<Record<HashCheck, string>> = {
    match: "Reconstructed view: this hash matches the TICKET_CREATED record in the run's provenance chain.",
    mismatch:
        "Reconstructed view: this hash does not match the TICKET_CREATED record, so treat the fields above as unverified.",
    absent:
        "Reconstructed view: no TICKET_CREATED record in this stream to check the hash against.",
};

interface FieldProps {
    label: string;
    value: string;
    sub?: string;
}

function Field({ label, value, sub }: FieldProps) {
    return (
        <div className="tkt-field">
            <dt>{label}</dt>
            <dd className="tkt-mono">
                {value}
                {sub !== undefined ? (
                    <span className="tkt-sub"> {sub}</span>
                ) : null}
            </dd>
        </div>
    );
}

/**
 * Ticket header: identity fields, parties, notionals, the CURRENT
 * lifecycle word, and the hash with its verification verdict. All ids,
 * amounts, and hashes render in mono; money displays through money.ts
 * formatting while the raw integer cents stay visible underneath.
 */
export default function TicketHeaderCard({ view }: TicketHeaderCardProps) {
    const { ticket, lifecycle, hashCheck } = view;
    const rate = formatRateScaled(ticket.rate_scaled, ticket.rate_scale);
    const checkClass =
        hashCheck === "match"
            ? "tkt-check tkt-check-match"
            : hashCheck === "mismatch"
              ? "tkt-check tkt-check-mismatch"
              : "tkt-check tkt-check-absent";

    return (
        <section className="tkt-card" aria-labelledby="tkt-slip-title">
            <div className="tkt-card-head">
                <div>
                    <p className="tkt-eyebrow">Trade ticket</p>
                    <h3 id="tkt-slip-title" className="tkt-card-title">
                        {ticket.ticket_id}
                    </h3>
                </div>
                <p
                    className={`tkt-life tkt-life-${lifeTone(lifecycle)}`}
                >
                    Current: {lifecycle}
                </p>
            </div>

            <dl className="tkt-grid">
                <Field label="Client order" value={ticket.cl_ord_id} />
                <Field label="Symbol" value={ticket.symbol} />
                <Field label="Side" value={sideLabel(ticket.side)} />
                <Field label="Trade date" value={ticket.trade_date} />
                <Field label="Value date" value={ticket.value_date} />
                <Field label="Rate" value={rate} sub={`scaled ${ticket.rate_scaled} / ${ticket.rate_scale}`} />
                <Field label="Settlement path" value={ticket.settlement_path} />
                <Field label="Scenario" value={ticket.scenario} />
                <Field label="Gap window" value={`${ticket.gap_ms} ms`} />
            </dl>

            <div className="tkt-money">
                <div className="tkt-money-cell">
                    <p className="tkt-money-label">
                        Base: leg 1 ({ticket.base_ccy})
                    </p>
                    <p className="tkt-money-value">
                        {fmt(BigInt(ticket.base_amount_cents), ticket.base_ccy)}
                    </p>
                    <p className="tkt-money-cents">
                        {ticket.base_amount_cents} cents
                    </p>
                </div>
                <div className="tkt-money-cell">
                    <p className="tkt-money-label">
                        Quote: leg 2 ({ticket.quote_ccy})
                    </p>
                    <p className="tkt-money-value">
                        {fmt(
                            BigInt(ticket.quote_amount_cents),
                            ticket.quote_ccy,
                        )}
                    </p>
                    <p className="tkt-money-cents">
                        {ticket.quote_amount_cents} cents
                    </p>
                </div>
            </div>

            <div className="tkt-parties">
                <p className="tkt-eyebrow">Parties</p>
                <ul className="tkt-party-list">
                    {[
                        { role: "Party A", party: ticket.party_a },
                        { role: "Party B", party: ticket.party_b },
                    ].map(({ role, party }) => (
                        <li key={role} className="tkt-party">
                            <span className="tkt-party-role">{role}</span>
                            <span className="tkt-party-desk">
                                {party.desk_id}
                            </span>
                            <code className="tkt-party-wallet">
                                {truncateWallet(party.wallet)}
                                <span className="tkt-visually-hidden">
                                    {" "}
                                    full wallet {party.wallet}
                                </span>
                            </code>
                            <CopyButton
                                value={party.wallet}
                                noun={`${role} wallet`}
                            />
                        </li>
                    ))}
                </ul>
            </div>

            <div className="tkt-hash-block">
                <div className="tkt-hash-row">
                    <p className="tkt-hash-label">ticket_hash</p>
                    <code className="tkt-hash">
                        {shortHash(ticket.ticket_hash)}
                        <span className="tkt-visually-hidden">
                            {" "}
                            full hash {ticket.ticket_hash}
                        </span>
                    </code>
                    <CopyButton value={ticket.ticket_hash} noun="ticket hash" />
                </div>
                <p className={checkClass}>{CHECK_COPY[hashCheck]}</p>
            </div>
        </section>
    );
}
