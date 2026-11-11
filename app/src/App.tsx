import { SCENARIOS } from "./engine/scenarios";

/**
 * Placeholder shell. Phase 4 replaces this with the side-by-side race UI
 * (sequential versus atomic lanes, wallet integration, offline mode).
 */
export default function App() {
    return (
        <main className="app-shell">
            <header className="app-header">
                <h1>Settlement Race</h1>
                <p className="app-tagline">
                    Tokenized USD/CAD exchange on Solana devnet: sequential
                    pay-first settlement versus atomic delivery-versus-payment.
                    Devnet play money only.
                </p>
            </header>

            <section className="race-lanes" aria-label="Race lanes">
                <article className="lane">
                    <h2>Sequential</h2>
                    <p>Pay the first leg, then wait, then hope.</p>
                </article>
                <article className="lane">
                    <h2>Atomic</h2>
                    <p>Both legs or neither. One transaction, one clock.</p>
                </article>
            </section>

            <section className="scenario-list" aria-label="Scenarios">
                <h2>Scenarios</h2>
                <ul>
                    {SCENARIOS.map((spec) => (
                        <li key={spec.kind}>
                            <strong>{spec.label}</strong>
                            <span>{spec.description}</span>
                        </li>
                    ))}
                </ul>
            </section>
        </main>
    );
}
