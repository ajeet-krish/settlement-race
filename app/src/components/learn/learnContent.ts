/**
 * Learn view content: every paragraph, figure, table cell, and citation
 * lives here as pure data so the structure can be tested without a DOM.
 * Inline citations use the [n] token syntax that matches docs/research.md
 * section 10; splitCitations turns that syntax into renderable segments.
 * All money facts carry their date and confidence wording from the
 * research file, and no copy or comment contains em dashes, double
 * hyphens, or dash equivalents.
 */

/** Opening hook, stated in full on the Learn panel. */
export const HOOK =
    "I built the reason CLS exists, in miniature, then made the risk disappear atomically and let you watch both timelines race.";

/** Plain English framing of what the app demonstrates. */
export const FRAMING =
    "This app races two ways to settle one tokenized USD/CAD trade on Solana devnet. The sequential lane pays one leg and then waits for the other, which is the exact gap that has cost FX counterparties real money since 1974, while the atomic lane moves both legs inside one transaction so the gap never opens. Every amount here is play money on devnet, and every figure below carries its citation number from the research file.";

/** Section identity: nav entry, heading, eyebrow, and accent role. */
export type LearnSectionTone = "risk" | "pvp" | "neutral";

export interface LearnSection {
    /** Anchor id, also used as the section element id. */
    id: string;
    /** In-page nav label, sentence case. */
    label: string;
    /** Mono eyebrow above the heading, uppercase via CSS. */
    eyebrow: string;
    /** Visible section heading. */
    title: string;
    /** Accent role: amber exposure, teal protection, neutral chrome. */
    tone: LearnSectionTone;
}

/** Sections in narrative order, used by the nav and the renderer. */
export const LEARN_SECTIONS: readonly LearnSection[] = [
    {
        id: "risk-window",
        label: "The risk window",
        eyebrow: "Exposure",
        title: "The risk window",
        tone: "risk",
    },
    {
        id: "what-cls-does",
        label: "What CLS does",
        eyebrow: "Payment versus payment",
        title: "What CLS does",
        tone: "pvp",
    },
    {
        id: "honest-limits",
        label: "Honest limits",
        eyebrow: "What this toy lacks",
        title: "What CLS does that this does not",
        tone: "risk",
    },
    {
        id: "atomic-settlement",
        label: "Atomic settlement",
        eyebrow: "Delivery versus payment",
        title: "What atomic settlement changes",
        tone: "pvp",
    },
    {
        id: "comparison",
        label: "Rail comparison",
        eyebrow: "Three rails side by side",
        title: "Three rails compared",
        tone: "neutral",
    },
    {
        id: "trust",
        label: "Trust note",
        eyebrow: "Verification",
        title: "What a VALID verdict trusts",
        tone: "neutral",
    },
    {
        id: "sources",
        label: "Sources",
        eyebrow: "Citations",
        title: "Sources",
        tone: "neutral",
    },
];

/** The risk window section, paragraph by paragraph. */
export const RISK_PARAS: readonly string[] = [
    "Settlement risk, also called cross currency settlement risk or principal risk in FX, opens when the two legs of a trade pay in different systems at different times. One side has already paid and the other has not. If the unpaid side fails inside that gap, the paid side is out the principal and receives nothing. The name comes from the 1974 failure; the risk existed before the name. [3]",
    "On 26 June 1974 the German banking supervisor withdrew the licence of Bankhaus Herstatt and forced it into liquidation at 16:30 local time in Cologne, which was 10:30 a.m. in New York: banking business had closed in Germany and the business day was still running in the United States. [1][2] Herstatt was Germany's 35th largest bank at the time, which is the point of the story: a mid sized bank caused an international payment seizure. [2][3]",
    "Counterparties had already paid Deutsche marks to Herstatt in Frankfurt on settlement day. The matching US dollar payment was to be made later that day in New York, Herstatt was shut in between, and the dollar leg never paid. [1][2] The counterparties were out one currency and received nothing for the other, and the gap between the two legs became known as Herstatt risk. [1][2][3]",
    "New York banks reacted by holding up outgoing payments until accounts were in credit, which nearly froze the clearing process; on two or three consecutive days clearing ran until 1 a.m. [2][41] On 1 July 1974 the New York Clearing House made international payments recallable until the next business day, a survival measure that drew formal protests from London on 16 July 1974 and from the Netherlands Bankers' Association on 23 July 1974. [2]",
    "The window was compressed, not eliminated. In April 2022 about USD 2.2 trillion per day of deliverable FX turnover, close to one third of it, was still subject to settlement risk, up from USD 1.9 trillion in April 2019. [14] Residual exposure comes from non CLS currencies, counterparties that are not CLS members, and settlement windows outside CLS coverage. [14][42]",
    "In this app the amber hatched interval in the race view is this exact exposure: one leg has left escrow, the second has not arrived, and a scripted counterparty failure inside that interval takes the money. The hatch used through this page carries the same meaning.",
];

/** Pull quote closing the risk window section. */
export const PULL_QUOTE =
    "The gap between the two legs is the exposure, and the clock creates the gap.";

/** What CLS does section, paragraph by paragraph. */
export const CLS_PARAS: readonly string[] = [
    "Payment versus payment means a party's payment instruction in one currency settles if and only if the corresponding payment instruction in the counter currency also settles. Neither side can end up having paid without receiving. [13]",
    "CLS implements that condition by synchronizing both legs inside one settlement window, using accounts it holds at central banks and links to local real time gross settlement systems, so both legs settle with finality at effectively the same moment. [9][10] Trades are submitted and matched in advance: for the main session, instructions for the settlement day must be submitted before the 00:00 CET cut-off on settlement day. [10][23]",
    "Each day before settlement, CLS calculates each settlement member's funding requirement on a multilaterally netted basis, per currency. The member pays in only the net amount it owes in each currency, while each individual trade still settles on a gross, PvP basis. [9][10] Settlement processing starts at 07:00 CET and the window typically runs about 07:00 to 09:00 CET, varying by currency. [23]",
    "CLS is a payment system, not a central counterparty: it matches and synchronizes payment instructions and does not novate FX trades or take market position risk. [9][13] It started on 9 September 2002 with seven currencies, including USD and CAD, and covers 18 today. [11][23]",
];

/** Sourced figures for the CLS section, each with a confidence note. */
export interface LearnFigure {
    /** Headline number in mono. */
    value: string;
    /** What the number measures. */
    label: string;
    /** Source line, may contain [n] citation tokens. */
    source: string;
    /** Confidence qualifier in the wording of the research file. */
    confidence: string;
}

export const CLS_FIGURES: readonly LearnFigure[] = [
    {
        value: "USD 8.0 trillion+",
        label: "payment value settled per day, currently, across 18 currencies",
        source: "CLS product page [10]",
        confidence:
            "Medium to high: operator reported, and payment value includes FX swaps so it runs larger than trade notional.",
    },
    {
        value: "USD 7.0 trillion+",
        label: "average daily payment value in 2024",
        source: "CLS presentation to the Canadian FX Committee, October 2024 [13]",
        confidence:
            "Medium to high: operator reported, with the same swap caveat.",
    },
    {
        value: "96 to 99 percent",
        label: "liquidity saved by multilateral netting, leaving average funding of roughly 1 to 4 percent of gross value",
        source: "CLS Group and a CLS funded analysis [9][10][12]",
        confidence:
            "Medium: figures vary by method and by document date. CLS cites about 1 percent, roughly USD 70 billion, of total payment instructions on a typical business day.",
    },
    {
        value: "T+2",
        label: "spot FX value date; CLS removes the risk window inside a settlement date, not the trade to settlement date gap",
        source: "CLS Group and the Swiss National Bank [10][23]",
        confidence: "High.",
    },
    {
        value: "23 Sep 2013",
        label: "CLS Americas Same Day Settlement Session for USD/CAD launched with 17 member banks, because the two currencies share a time zone",
        source: "WatersTechnology, 23 September 2013 [22]",
        confidence: "High.",
    },
];

/** The mandatory honesty box: what CLS provides that this toy does not. */
export interface ClsLimitItem {
    /** Mono uppercase term, always phrased as a missing protection. */
    term: string;
    /** Plain explanation, may contain [n] citation tokens. */
    body: string;
}

export interface ClsLimitsBox {
    eyebrow: string;
    title: string;
    intro: string;
    items: readonly ClsLimitItem[];
    footer: string;
}

export const CLS_LIMITS_BOX: ClsLimitsBox = {
    eyebrow: "Honesty check",
    title: "What CLS does that this does not",
    intro: "Real CLS is an industrial settlement infrastructure. This demo is one devnet trade with a scripted counterparty. Everything below is a protection the toy does not have, stated plainly before you compare the rails.",
    items: [
        {
            term: "No multilateral netting",
            body: "CLS nets obligations across thousands of trades per member per day and cuts funding needs by roughly 96 to 99 percent. [9][10][12] This toy nets nothing: one trade in isolation, so the net obligation equals the gross obligation, N = G, and every run funds the full trade value.",
        },
        {
            term: "No intraday credit",
            body: "On real rails an obligation can be met during the operating day from prefunded balances or central bank intraday credit under a rulebook. [18][21] The toy has no credit line: it moves only what both parties already escrowed, so a shortfall simply blocks settlement.",
        },
        {
            term: "No central bank money",
            body: "CLS settles both legs through accounts it holds at central banks, in central bank money. [9][10] The toy settles SPL token balances on Solana devnet, the chain's own money, where legal settlement finality and creditor protection are weaker and unsettled in law. [32]",
        },
        {
            term: "No legal finality",
            body: "No settlement finality statute, no netting opinions, no insolvency treatment, no supervisory oversight. [30][40] In the real world those are what make PvP binding.",
        },
        {
            term: "Simulated counterparty failure",
            body: "The defaulting party here is a scripted bot running in your browser, and the failure is staged to show the window rather than caused by a counterparty default. [1][14] The 1974 loss was a real bank failing in real time. [1][2]",
        },
        {
            term: "Toy scale",
            body: "One USD/CAD trade, two SPL token mints, no membership rules, no CCP, no default fund, no loss sharing waterfall. [9][40] For scale, CLS settles over USD 8.0 trillion of payment value per day across 18 currencies. [10]",
        },
        {
            term: "Play money on devnet",
            body: "Devnet play money only. No real funds, no mainnet, and no claim of legal settlement finality.",
        },
    ],
    footer: "Also missing here: value dates, cut-off times, a business day calendar, membership rules, and a default fund. Real CLS spot FX settles T+2 inside a synchronized window, and real residual Herstatt risk concentrates in value date gaps and out of window trades. [10][14]",
};

/** Atomic settlement section, paragraph by paragraph. */
export const ATOMIC_PARAS: readonly string[] = [
    "Delivery versus payment is a settlement method in which the securities are released only if payment is made, so both sides settle together and principal risk is eliminated. [28] CPSS published the design work in 1992, and the CPSS IOSCO recommendations of November 2001 made DvP the expected standard for securities settlement. [27][26] Payment versus payment is the FX version of the same idea: the two legs are two different currencies instead of cash versus securities. [13][26]",
    "In this app both legs are token transfers inside one Solana transaction. If every instruction succeeds, both transfers commit; if any instruction fails, the whole transaction reverts and no funds move. [24][25] That is exactly the DvP condition: delivery happens if and only if payment happens.",
    "In traditional markets the cash leg and the asset leg live in different infrastructures, an RTGS for cash, a CSD for securities, two RTGS systems for two currencies, so synchronization is a special purpose engineering problem. [24][25][27] On chain both legs are account states in the same ledger, so the exchange reduces to all or nothing execution. The honest headline of this demo: in a real DvP the two assets live in different systems, while here both legs are SPL token balances in one program, so the hard part of synchronization is given away by the ledger.",
];

/** Where stablecoin rails genuinely help. */
export const ATOMIC_GAINS: readonly string[] = [
    "24/7 operation with no cut-off and no value date for the exchange itself, which removes the intraday Herstatt style window entirely for the pair being traded. [36]",
    "One ledger, one clock: both legs are balances on the same chain, so simultaneity is the default rather than a special purpose engineering effort. [24][25]",
    "Programmable conditions: escrow, timeouts, and refund paths are written into the program instead of negotiated as legal text.",
    "A transparent audit trail and near instant application level finality. [24][25][36]",
    "Industry validation: BIS Project Mariana concluded in 2024 after testing a hypothetical wholesale CBDC setup aiming at atomic PvP settlement on a public blockchain [37], and in the BIS 2024 survey 77 percent of respondents named delivery versus payment and 71 percent named payment versus payment among envisioned use cases [38].",
];

/** The honest counterpoints against atomic stablecoin settlement. */
export const ATOMIC_COSTS: readonly string[] = [
    "Atomicity is not netting: all or nothing means you fund the whole trade every time. CLS members fund about 1 to 4 percent of gross value because obligations are netted across thousands of trades; a gross atomic ledger makes you fund the full trade value every time. This is a real economic cost, not a detail. [9][10][12]",
    "Custody risk moves from a supervised institution to key management, with no chargeback or fraud recovery. [32]",
    "Issuer risk: a stablecoin is a claim on an issuer, not central bank money, depegs have happened, and issuers can freeze balances. [33][32]",
    "Legal finality is unsettled: the US Treasury and the President's Working Group flagged that many networks have no single party accountable for legal settlement finality. [32]",
    "Regulation is young: the GENIUS Act was enacted on 18 July 2025 and its federal framework, with 1:1 reserves and permitted issuers only, takes effect on 18 January 2027. [34][35]",
    "Ramps keep the clock: the chain runs 24/7 but on ramps and off ramps into fiat do not, creating new timing mismatches. [36][32]",
    "Failed transactions still cost fees, and every flow must fit into one transaction or a well designed escrow state machine. [24][25]",
];

/** Trust note paragraphs, tied to the evidence panel wording. */
export const TRUST_PARAS: readonly string[] = [
    "Chain verification in this app is local computation plus two trust anchors. The app recomputes every hash in the provenance chain and compares the result with the chain head anchored on devnet, fetched through the RPC endpoint you are connected to and written by the demo driver key.",
    "So a VALID verdict means the chain has not been altered since it was anchored, as reported by that RPC. When the evidence panel shows VALID, it will mean each attached devnet transaction was fetched from RPC and checked for program id and success, under the same two anchors: the RPC endpoint and the demo driver key. Phase 6 adds that panel.",
];

/** Comparison table columns, in presentation order. */
export type RailKey = "wire" | "cls" | "stable";

export interface RailColumn {
    key: RailKey;
    /** Column header, sentence case. */
    label: string;
    /** Mono sub line under the header. */
    sub: string;
}

export const RAILS: readonly RailColumn[] = [
    { key: "wire", label: "Wire transfer", sub: "Fedwire / CHIPS" },
    { key: "cls", label: "CLS", sub: "PvP FX settlement" },
    { key: "stable", label: "Stablecoin atomic DvP", sub: "Solana, this demo" },
];

/** One row of the comparison table: a dimension plus three cells. */
export interface ComparisonRow {
    /** Row header text. */
    label: string;
    /** Cell text per rail, may contain [n] citation tokens. */
    cells: Record<RailKey, string>;
}

/** The six required comparison dimensions, in reading order. */
export const COMPARISON_ROWS: readonly ComparisonRow[] = [
    {
        label: "Settlement mechanism",
        cells: {
            wire: "Gross, payment by payment settlement that is irrevocable and final in central bank money during the operating day. Fedwire Funds gives real time, immediate finality on the day of value [21] and averaged about USD 4.5 trillion per day in 2024, with an average transfer of about USD 5.4 million [17].",
            cls: "Payment versus payment: both legs synchronized inside one settlement window, each trade settled gross while the member's funding requirement is calculated multilaterally per currency. [9][10][13]",
            stable: "Both legs are token transfers inside one Solana transaction: all instructions succeed or the entire transaction reverts and no intermediate state is committed. [24][25]",
        },
    },
    {
        label: "Risk exposure",
        cells: {
            wire: "Unconditional: a wire cannot be conditioned on receipt of the other leg, so the payer is exposed from payment until the counter value arrives, and cross border legs still span systems and value dates.",
            cls: "Principal risk eliminated for eligible trades inside the window [13]. Residual exposure sits outside coverage: about USD 2.2 trillion per day of FX turnover still carried settlement risk in April 2022, up from USD 1.9 trillion in April 2019. [14][42]",
            stable: "Zero exposure on the exchange itself: a failed transaction reverts whole, so post failure state equals pre trade state [24][25]. The risk moves to custody, depeg, and issuer freeze. [32][33]",
        },
    },
    {
        label: "Finality",
        cells: {
            wire: "Immediate and final on the day of value in central bank money; about 95 percent of CHIPS payments reach finality in seconds, on about USD 2 trillion per day. [18][21]",
            cls: "Both legs final at effectively the same moment through central bank accounts and RTGS links [9][10]; the spot FX value date is normally T+2. [10][23]",
            stable: "Near instant application level finality after confirmation [24]; legal settlement finality remains unsettled in law. [32]",
        },
    },
    {
        label: "Netting",
        cells: {
            wire: "Fedwire is gross and payment by payment [21]. CHIPS uses prefunded balances with continuous bilateral and multilateral position checks, turning about USD 1 of funding into about USD 26 of settled value. [18]",
            cls: "Multilateral netting saves about 96 percent of funding, up to about 99 percent with the in/out swap tool; average funding is roughly 1 to 4 percent of gross value, about USD 70 billion on a typical day [9][10][12] (medium confidence: method varies by document date).",
            stable: "None. Gross and atomic means pre funding, so liquidity needs scale with gross trade value [10][12]; in this demo N = G.",
        },
    },
    {
        label: "Availability",
        cells: {
            wire: "Fedwire business day runs 9:00 p.m. to 7:00 p.m. ET, five days a week [19]; a Federal Reserve decision announced on 17 November 2025 expands the same daily hours to Sundays and holidays [20], treated here as announced rather than confirmed.",
            cls: "Settlement window typically about 07:00 to 09:00 CET, varying by currency, with submissions due before the 00:00 CET cut-off; 18 currencies, members and their customers only. [11][23]",
            stable: "24/7 on chain with no cut-off [36]; fiat on ramps and off ramps are not 24/7, which creates new timing mismatches [36][32]. This demo runs on devnet.",
        },
    },
    {
        label: "Status in this demo",
        cells: {
            wire: "Not simulated. Shown as the reference rail for gross, pay first settlement.",
            cls: "Not simulated either. The sequential lane reproduces the exposure CLS was built to close, without CLS synchronization or netting.",
            stable: "This demo: one tokenized USD/CAD trade on devnet, both legs as SPL tokens, atomic lane settled in a single transaction. Play money only.",
        },
    },
];

/** Caption above the comparison table, also its accessible name. */
export const TABLE_CAPTION =
    "Six dimensions across three rails: wire transfer, CLS, and stablecoin atomic delivery versus payment. Figures carry the date and confidence of their citation.";

/** One entry of the sources list, numbered as in docs/research.md. */
export interface Citation {
    /** Short source label as it appears in the sources list. */
    label: string;
    /** URL exactly as listed in docs/research.md section 10. */
    url: string;
}

/** Citations used on this page, keyed to docs/research.md section 10. */
export const CITATIONS: Readonly<Record<number, Citation>> = {
    1: {
        label: "Wikipedia, Herstatt Bank: mechanism, times, aftermath",
        url: "https://en.wikipedia.org/wiki/Herstatt_Bank",
    },
    2: {
        label: "B. Norman, Bank of England Bank Underground, 24 June 2015: archives on the 1974 Herstatt failure",
        url: "https://bankunderground.co.uk/2015/06/24/boe-archives-reveal-little-known-lesson-from-the-1974-failure-of-herstatt-bank/",
    },
    3: {
        label: "ECB Financial Stability Review, December 2007: FX settlement risk box",
        url: "https://www.ecb.europa.eu/press/financial-stability-publications/fsr/focus/2007/pdf/ecb~ccda416def.fsrbox200712_19.pdf",
    },
    9: {
        label: "CLS Group: the necessary ingredients for a PvP arrangement",
        url: "https://www.cls-group.com/insights/the-fx-ecosystem/what-are-the-necessary-ingredients-for-any-pvp-arrangement-to-work",
    },
    10: {
        label: "CLS Group: CLSSettlement product page",
        url: "https://www.cls-group.com/products/settlement/clssettlement",
    },
    11: {
        label: "CLS Group: eligible currencies page",
        url: "https://www.cls-group.com/products/settlement/clssettlement/currencies/",
    },
    12: {
        label: "CLS Group, March 2025: exploring the case for additional settlement cycles",
        url: "https://www.cls-group.com/media/lnocyvna/cls_fna_report_reimagining_-sameday_fx_mar2025.pdf",
    },
    13: {
        label: "CLS presentation to the Canadian Foreign Exchange Committee, Bank of Canada, October 2024",
        url: "https://www.bankofcanada.ca/wp-content/uploads/2024/10/cls-presentation.pdf",
    },
    14: {
        label: "BIS Quarterly Review, December 2022: FX settlement risk, an unsettled issue",
        url: "https://www.bis.org/publications/qr-202212/fx-settlement-risk-unsettled-issue",
    },
    17: {
        label: "Federal Reserve Banks: Fedwire Funds Service PFMI disclosure, 2024 averages",
        url: "https://www.frbservices.org/wp-content/uploads/funds-service-disclosure.pdf",
    },
    18: {
        label: "The Clearing House: CHIPS product page",
        url: "https://www.theclearinghouse.org/payment-systems/CHIPS",
    },
    19: {
        label: "Federal Reserve Bank services: Fedwire and National Settlement Service operating hours",
        url: "https://www.frbservices.org/resources/financial-services/wires/fedwire-funds-service-national-settlement-service-operating-hours/",
    },
    20: {
        label: "Federal Register, 17 November 2025: operating hours expansion for Fedwire and the National Settlement Service",
        url: "https://www.federalregister.gov/documents/2025/11/17/2025-19942/federal-reserve-action-to-expand-fedwirer-funds-service-and-national-settlement-service-operating",
    },
    21: {
        label: "Federal Reserve: Fedwire Funds core principles assessment, RTGS and immediate finality",
        url: "https://www.federalreserve.gov/paymentsystems/fedfunds_coreprinciples.htm",
    },
    22: {
        label: "WatersTechnology, 23 September 2013: CLS debuts USD/CAD same-day settlement",
        url: "https://www.waterstechnology.com/trading-tech/2296231/cls-debuts-usdcad-same-day-settlement",
    },
    23: {
        label: "Swiss National Bank: the Continuous Linked Settlement foreign exchange settlement system",
        url: "https://www.snb.ch/dam/jcr:92bb643e-a03e-4970-a8ce-0dadae60b130/continuous_linked_settlement.en.pdf",
    },
    24: {
        label: "Solana documentation: transactions, atomic execution, fees charged on failure",
        url: "https://solana.com/docs/core/transactions",
    },
    25: {
        label: "Solana documentation: transaction pipeline, commit or rollback",
        url: "https://solana.com/docs/core/transactions/transaction-pipeline",
    },
    26: {
        label: "CPSS and IOSCO, November 2001: recommendations for securities settlement systems",
        url: "https://www.iosco.org/library/pubdocs/pdf/ioscopd123.pdf",
    },
    27: {
        label: "CPSS, 1992: delivery versus payment in securities settlement systems",
        url: "https://www.bis.org/publications/delivery-versus-payment-securities-settlement-systems",
    },
    28: {
        label: "Investopedia: delivery versus payment, plain language definition",
        url: "https://www.investopedia.com/terms/d/dvp.asp",
    },
    30: {
        label: "ISDA: opinions overview on close out netting enforceability",
        url: "https://www.isda.org/opinions-overview/",
    },
    32: {
        label: "US Treasury, FDIC, OCC and the President's Working Group, November 2021: stablecoins report",
        url: "https://home.treasury.gov/system/files/136/StableCoinReport_Nov1_508.pdf",
    },
    33: {
        label: "FSB, 23 July 2024: cross-border regulatory issues of global stablecoin arrangements",
        url: "https://www.fsb.org/uploads/P230724.pdf",
    },
    34: {
        label: "US Congress: GENIUS Act, Public Law 119-27, enacted 18 July 2025",
        url: "https://www.congress.gov/bill/119th-congress/senate-bill/1582",
    },
    35: {
        label: "OCC Bulletin 2026-50: GENIUS Act regulations final rule",
        url: "https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-50.html",
    },
    36: {
        label: "Visa: how stablecoins are reinventing cross-border payments",
        url: "https://www.visa.com/en-us/thought-leadership/global-money-movement/stablecoins-are-reinventing-cross-border-payments",
    },
    37: {
        label: "BIS Innovation Hub: Project Mariana, concluded 2024",
        url: "https://www.bis.org/project/mariana",
    },
    38: {
        label: "BIS, 2024: results of the CBDC and crypto survey",
        url: "https://www.bis.org/publications/paper-159-advancing-tandem-results-2024-bis-survey-central-bank-digital-currencies-and-crypto",
    },
    40: {
        label: "CPSS and IOSCO, April 2012: principles for financial market infrastructures",
        url: "https://www.bis.org/cpmi/publ/d101a.pdf",
    },
    41: {
        label: "C. Schenk, 2014: banking failures of 1974 and the USD liquidity crisis",
        url: "https://academic.oup.com/ehr/article/129/540/1129/2769724",
    },
    42: {
        label: "Federal Reserve Bank of New York, 2020: understanding FX settlement risk",
        url: "https://www.newyorkfed.org/medialibrary/microsites/fxc/files/2020/FX_settlement_risk.pdf",
    },
};

/** Citations in ascending numeric order, for the sources list. */
export const CITATION_ENTRIES: ReadonlyArray<readonly [number, Citation]> =
    Object.entries(CITATIONS)
        .map(([key, citation]) => [Number(key), citation] as const)
        .sort((a, b) => a[0] - b[0]);

/** A run of plain text or one citation token from a copy string. */
export type CitationSegment =
    | { kind: "text"; value: string }
    | { kind: "cites"; nums: number[] };

/**
 * Split a copy string into text and citation segments. Consecutive
 * tokens such as [1][2] merge into one segment so they render as a
 * single superscript group. A fresh regex each call keeps lastIndex
 * state out of the shared path.
 */
export function splitCitations(text: string): CitationSegment[] {
    const segments: CitationSegment[] = [];
    const pattern = /\[(\d+)\]/g;
    let cursor = 0;
    let match = pattern.exec(text);
    while (match !== null) {
        const index = match.index;
        const num = Number(match[1]);
        const previous = segments[segments.length - 1];
        if (index === cursor && previous?.kind === "cites") {
            previous.nums.push(num);
        } else {
            if (index > cursor) {
                segments.push({
                    kind: "text",
                    value: text.slice(cursor, index),
                });
            }
            segments.push({ kind: "cites", nums: [num] });
        }
        cursor = index + match[0].length;
        match = pattern.exec(text);
    }
    if (cursor < text.length) {
        segments.push({ kind: "text", value: text.slice(cursor) });
    }
    return segments;
}
