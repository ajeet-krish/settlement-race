import { TICKET_FIELD_DOCS } from "./ticketView";

/**
 * Schema reference: the full version 1 field table from
 * docs/tradeops-schema.md inside a native details element, so the
 * section is collapsed by default, keyboard operable, and announced
 * correctly without any script. The table columns give way to each
 * other instead of scrolling, so narrow screens read it inline.
 */
export default function SchemaReference() {
    return (
        <section className="tkt-card" aria-labelledby="tkt-schema-title">
            <h3 id="tkt-schema-title" className="tkt-visually-hidden">
                Schema reference
            </h3>
            <details className="tkt-schema">
                <summary className="tkt-schema-summary">
                    Schema reference: {TICKET_FIELD_DOCS.length} fields of the
                    FIX inspired ticket
                </summary>
                <p className="tkt-schema-note">
                    Schema version 1, spelled out in docs/tradeops-schema.md
                    section 1.1. Every field below is serialized as canonical
                    JSON and hashed into ticket_hash, so the chain commits to
                    the exact text a party read.
                </p>
                <div className="tkt-table-wrap">
                    <table className="tkt-table">
                        <thead>
                            <tr>
                                <th scope="col">Field</th>
                                <th scope="col">Type</th>
                                <th scope="col">Meaning</th>
                            </tr>
                        </thead>
                        <tbody>
                            {TICKET_FIELD_DOCS.map((doc) => (
                                <tr key={doc.field}>
                                    <td className="tkt-table-field">
                                        {doc.field}
                                    </td>
                                    <td className="tkt-table-type">
                                        {doc.type}
                                    </td>
                                    <td>{doc.meaning}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </section>
    );
}
