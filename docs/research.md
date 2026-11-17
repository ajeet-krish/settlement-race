# Settlement Race Research

Last updated: 2026-11-10

This file is append only. Add new findings as a new dated section at the end, under a heading of the form "YYYY-MM-DD - Topic". Do not rewrite earlier entries. If a fact is later found to be wrong, append a correction under the newest date and reference the original claim.

Scope of this project: a tokenized USD/CAD exchange on Solana devnet that compares traditional sequential (pay-first) settlement against atomic on-chain delivery-versus-payment (DvP), to demonstrate settlement risk and why institutions such as CLS exist. All amounts are devnet play money.

## 2026-11-10 - Settlement risk, PvP, and atomic DvP foundations

### 1. Herstatt risk: the 1974 origin

What happened

- Bankhaus Herstatt was a privately owned bank in Cologne, Germany. On 26 June 1974 the German banking supervisor (Bundesaufsichtsamt fuer das Kreditwesen) withdrew its licence and forced it into liquidation after sizeable losses on speculative foreign exchange positions. [1][3][8]
- Herstatt was Germany's 35th largest bank at the time, which is the point of the story: a mid-sized bank caused an international payment seizure. [2][3]
- The German authorities closed the bank at 16:30 local time, which was 10:30 a.m. in New York. The action came after close of banking business in Germany but during the business day in the United States. [1][2]

The exact mechanism (the time-zone settlement gap)

- An FX trade has two legs in two currencies, settled in two different payment systems in two different time zones on the same calendar day.
- Counterparties had already paid Deutsche marks to Herstatt in Frankfurt on settlement day. The corresponding US dollar payment was to be made later that day in New York. Herstatt was closed in between, so the dollar leg never paid. [1][2]
- Herstatt's counterparties therefore lost the principal they had already paid: they were out one currency and received nothing for the other. That gap between the two legs became known as Herstatt risk. [1][2][3]
- This is FX settlement risk, also called cross-currency settlement risk or principal risk in FX. The name is the 1974 failure, the risk itself existed before the name. [3]

What it triggered (contagion first, standards after)

- New York banks reacted by holding up outgoing payments until accounts were in credit, which nearly froze the clearing process; on two or three consecutive days clearing ran until 1 a.m. [2][41]
- On 1 July 1974 the New York Clearing House implemented a recall procedure: international payments were not final until the business day after the payment order was released. This was a survival measure that itself injected new uncertainty, and it drew formal protests from London (16 July 1974) and from the Netherlands Bankers' Association (23 July 1974). [2]
- London clearing banks refused to accept conditional orders (sterling payments subject to recall if the New York counter-value was not delivered). [2]
- Germany created the Liquidity Consortium Bank in the following months to provide emergency liquidity. [1]
- The Basel Committee on Banking Supervision was established by the central bank Governors of the Group of Ten at the end of 1974, in the aftermath of the Herstatt failure and related disturbances, to improve international banking supervision. Some secondary sources date the Committee to 1975, which refers to its early meetings. [8][1]
- CPSS, the Committee on Payment and Settlement Systems at the BIS, took up FX settlement risk in a three track strategy [3][5][7]:
  Track 1: central banks strengthen their own payment and settlement systems to reduce timing mismatches.
  Track 2: private market participants adopt controls such as bilateral netting (estimated by the New York Foreign Exchange Committee to cut bilateral settlement exposure by up to about 60 percent [31]) and payment-versus-payment (PvP).
  Track 3: central banks use supervisory incentives to force private sector progress. [3][4][5][7]
- Key CPSS and Basel milestones:
  CPSS (March 1996), "Settlement risk in foreign exchange transactions", the founding report of the modern strategy. [4]
  CPSS (July 1998), "Reducing foreign exchange settlement risk: a progress report". [5]
  BCBS (September 2000), "Supervisory guidance for managing settlement risk in foreign exchange transactions". [3][6]
  CPSS Core Principles for Systemically Important Payment Systems (January 2001) and CPSS-IOSCO Recommendations for Securities Settlement Systems (November 2001). [26]
  CLS Bank began operating in September 2002, the direct result of the CPSS strategy. [3][42][43]
  CPSS (May 2008), "Progress in reducing foreign exchange settlement risk". [7]
  CPSS-IOSCO Principles for Financial Market Infrastructures (April 2012), which still treats settlement risk as a core risk to be eliminated or strictly limited. [40]

Why it still matters today

- Herstatt risk was compressed, not eliminated. In April 2022, about USD 2.2 trillion per day of deliverable FX turnover (close to one third of it) was still subject to settlement risk, up from USD 1.9 trillion in April 2019. [14]
- Residual exposure comes from non-CLS currencies, counterparties that are not CLS members, on-us trades without loss protection, and settlement windows outside CLS coverage. [14][42]
- Policy worry renewed after the US and Canada moved securities to T+1 on 27 and 28 May 2024, because same day FX and margin calls became more operationally tight. [29][12]

### 2. Payment-versus-Payment (PvP) and what CLS actually does

Definition

- PvP means a party's payment instruction in one currency is settled if and only if the corresponding payment instruction in the counter currency is also settled. Neither side can end up having paid without receiving. [13]
- CLS implements PvP by synchronizing both legs inside one settlement window, using accounts it holds at central banks and links to local RTGS systems, so both legs settle with finality at effectively the same moment. [9][10]

CLS mechanics (the parts worth describing in the README)

- Trades are submitted and matched in advance. For the main session, instructions for the settlement day must be submitted before the 00:00 CET cut-off on settlement day. [10][23]
- Each day before settlement, CLS calculates each settlement member's funding requirement on a multilaterally netted basis, per currency. The member pays in only the net amount it owes in each currency, while each individual trade still settles on a gross, PvP basis. [9][10]
- The initial pay-in schedule is issued shortly after the midnight CET cut-off so members can review the net obligation. [9]
- Settlement processing starts at 07:00 CET; the settlement window typically runs about 07:00 to 09:00 CET, varying by currency. [23]
- Settlement value date: spot FX normally settles T+2. CLS is not instant. It removes the risk window inside a settlement date, it does not remove the trade to settlement date gap. [10][23]
- CLS started on 9 September 2002 with seven currencies, including USD and CAD. It now covers 18 currencies (USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD, SGD, HKD, DKK, NOK, SEK, MXN, ZAR, KRW, HUF, ILS). [11][13]
- CLS is a payment system, not a central counterparty: it matches and synchronizes payment instructions, it does not novate FX trades or take market position risk. [9][13]
- USD/CAD specific fact: CLS launched its Americas Same-Day Settlement Session (SDS) for USD/CAD on 23 September 2013 with 17 member banks, specifically because USD and CAD share a time zone and same day volume was large. [22]

Numbers to quote

- CLS settles over USD 8.0 trillion of payment value per day across 18 currencies (CLS product page, current). [10]
- CLS settled over USD 7.0 trillion on average daily in 2024, described by CLS as the world's largest financial market infrastructure by value. [13]
- Multilateral netting delivers about 96 percent liquidity savings on its own, up to about 99 percent when members use the optional in/out swap tool, leaving average funding of roughly 1 to 4 percent of gross value; CLS cites about 1 percent (roughly USD 70 billion) of total payment instructions on a typical business day. [9][10][12]
- A CLS funded analysis reports a 94.8 percent multilateral netting efficiency in one scenario, and notes that about USD 500 billion per day of same day FX volume is not eligible for CLSSettlement. [12]

What CLS is not (needed for an honest comparison)

- No instant settlement. Value dates, cut-offs, and business days still apply.
- No universal coverage. Only 18 currencies, only members and their customers, only inside the operating window.
- No multilateral netting benefit for a single isolated trade. The funding saving comes from the aggregate of thousands of trades per member per day.
- No customer onboarding for the public. CLS settles bank to bank (settlement members and their third party customers). [9][10]

### 3. Traditional rails compared with CLS and with on-chain settlement

Rail A: wire transfer in a real time gross settlement (RTGS) system

- What it is: gross, payment by payment, irrevocable and final settlement in central bank money during the operating day. Fedwire Funds is an RTGS system that provides real time, immediate finality on the day of value. [21]
- Scale: Fedwire Funds averaged about USD 4.5 trillion per day in 2024, average transfer about USD 5.4 million. [17]
- Hours: the Fedwire business day runs 9:00 p.m. ET to 7:00 p.m. ET, five days a week; in 2025 the Federal Reserve decided to extend the same daily hours to Sundays and holidays. [19][20]
- CHIPS is the private sector alternative: about USD 2 trillion per day, using prefunded balances and continuous bilateral and multilateral position checks so that about 95 percent of payments reach finality in seconds while still capturing netting liquidity savings, roughly turning USD 1 of funding into USD 26 of settled value. [18]
- Strengths: legal finality in central bank money, high speed inside operating hours, simple mental model (money is gone when it is gone), no counterparty obligation left open after finality.
- Weaknesses: operating hours and weekday calendars, pre funding or intraday credit required, a wire is irrevocable and cannot be conditioned on receipt of the other leg, cross-border legs still span systems and value dates, correspondent chain costs and cut-offs.

Rail B: CLS (PvP FX settlement)

- Strengths: eliminates principal risk on the FX exchange itself for eligible trades, huge funding saving through multilateral netting, central bank money finality, decades of operational track record, industry standard for the FX market.
- Weaknesses: T+2 style value dates, membership and cut-off driven, only 18 currencies, no coverage for non members or out of window trades, no instant or 24/7 operation, complexity of funding deadlines creates its own intraday liquidity pressure (a member that misses pay-in does not settle). [9][12][23]

Rail C: stablecoin or tokenized cash settlement on a public chain

- Strengths: 24/7 operation with no cut-off, single ledger for both legs so the exchange can be atomic, programmable escrow logic, near instant application level finality, transparent audit trail, low marginal cost per transfer, easy composability with other tokenized instruments. [24][25][36]
- Weaknesses (honest list):
  Atomicity comes from transaction rollback, which also means partial failure is impossible to represent, so every flow must be expressible as one transaction or a well designed escrow state machine. Fees are charged even when a transaction fails. [24][25]
  The chain settles in its own money, not central bank money, so legal settlement finality and creditor protection are weaker and unsettled in law. The US Treasury and the President's Working Group flagged that many networks have no single party accountable for legal settlement finality. [32]
  Operational hours of the chain are 24/7 but on ramps and off ramps into fiat are not, creating new timing mismatches. [36][32]
  Custody and key management risk sits with the user: a lost or stolen key is a loss, not a recoverable payment error.
  Stablecoin issuer risk: depeg, reserve quality, and the issuer's ability to freeze balances. [33][32]
  Regulation is young and fragmented: US GENIUS Act (enacted 18 July 2025, effective date 18 January 2027), EU MiCA, FATF travel rule obligations. [34][35][36]
  Gross and atomic means pre funding: no multilateral netting, so liquidity needs scale with gross trade value. [10][12]
  Smart contract, oracle, bridge, and reorganization risk are new failure modes that do not exist in RTGS.

### 4. Why atomic on-chain DvP is proposed as an improvement, and the counterpoints

The case for

- One ledger, one clock. In traditional markets cash and the asset sit in different infrastructures (an RTGS for cash, a CSD for securities, two RTGS systems for two currencies), so synchronization is a special purpose engineering problem. On chain both legs are account states in the same ledger, so the exchange reduces to all-or-nothing execution. [24][25][27]
- Atomicity is enforced by the protocol, not by a rulebook. On Solana, all instructions in a transaction succeed or the entire transaction reverts and no intermediate state is committed. [24][25]
- 24/7 with no cut-off and no value date for the exchange itself, which removes the intra day Herstatt style window entirely for the pair being traded. [36]
- Programmable conditions (escrow, price limits, timeouts, refund paths) can be written into the program instead of negotiated as legal text. [39]
- Industry validation: BIS Project Mariana (concluded 2024) tested cross border trading and settlement of hypothetical wholesale CBDCs using DeFi primitives on a public blockchain, aiming at atomic PvP settlement. In the BIS 2024 CBDC survey, 77 percent of respondents named delivery versus payment and 71 percent named payment versus payment among envisioned use cases. [37][38]

The honest counterpoints

- Atomic settlement removes principal risk but also removes netting. CLS members fund about 1 to 4 percent of gross value because obligations are netted across thousands of trades; a gross atomic ledger makes you fund the full trade value every time. This is a real economic cost, not a detail. [9][10][12]
- Volatility and issuer risk. A stablecoin is a claim on an issuer, not central bank money, and depegs have happened. [33][32]
- Custody risk shifts from a supervised institution to key management, with no chargeback or fraud recovery. [32]
- Regulation and legal finality. GENIUS Act creates a federal framework with 1:1 reserves and permitted issuers, but the regime only takes effect on 18 January 2027 and global rules remain uneven. [34][35]
- Operational complexity: wallets, blockhash expiry, fee payer funding, congestion, commitment levels (processed, confirmed, finalized), and the difference between application level success and legal finality. [24][32]
- Transparency cuts both ways: a public ledger exposes balances and flows to everyone.
- Scale reality check: most stablecoin activity is still crypto market and treasury use rather than wholesale payment flows, and cross-border on/off ramps remain the bottleneck. [33][36]
- Complementary, not a replacement: the credible near term path is tokenized deposits and regulated stablecoins settling alongside RTGS, with netting layers above a gross base layer. [36]

### 5. DvP in traditional markets versus the on-chain mapping

Traditional definition

- Delivery versus payment is a securities settlement method in which the securities are released only if payment is made, so both sides settle together and principal risk is eliminated [28]. CPSS published "Delivery versus payment in securities settlement systems" in 1992 (CPSS Publications No. 6), which established the concept and its design models, and CPSS-IOSCO recommendation work in 2001 made DvP the expected standard for securities settlement. [27][26]
- Close relative: PvP is the FX version of the same idea, where the two legs are two different currencies instead of cash versus securities. [13][26]
- In practice, DvP requires linking infrastructures that were built separately, which is why real world DvP systems involve synchronizers, queues, and partial delivery arrangements, and why residual risk classes (principal risk, liquidity risk, replacement cost risk) are discussed at all. [26][27]

Mapping to an on-chain atomic swap

- Both legs are token transfers inside one atomic transaction. If every instruction succeeds, both transfers commit; if any instruction fails, the whole transaction reverts and no funds move. That is exactly the DvP condition: delivery happens if and only if payment happens. [24][25]
- The cross-chain variant of the same idea is the hash time locked contract (HTLC) atomic swap: a hashlock makes the second leg claimable only with a secret revealed by the first leg, and a timelock refunds the payer if the secret never arrives. Herlihy (2018) formalizes atomic cross chain swaps. [39]
- What maps cleanly: simultaneity, elimination of principal risk on the exchange, refund on failure, and an auditable state machine.
- What does not map: settlement in central bank money, legal finality, netting, value date conventions, membership and default management, and the requirement by regulators that a failing party's obligations be handled under a rulebook rather than by code. [9][40][32]
- Practical distinction for this project: in a real DvP the two assets live in different systems, while in this toy both legs are SPL token balances on Solana devnet in a single program, so the hard part of DvP (synchronization across infrastructures) is given away by the ledger. That is the honest headline of the demo.

### 6. Honest limits of this toy (use this section verbatim in the README)

- Devnet play money only. No real funds, no mainnet, no claim of legal settlement finality.
- No multilateral netting: CLS nets across thousands of trades per member per day and cuts funding needs by roughly 96 to 99 percent. The toy settles each trade gross, one trade at a time. [9][10][12]
- No value dates, no cut-off times, no business day calendar. Real CLS spot FX settles T+2 within a synchronized window; real residual Herstatt risk is concentrated in value date gaps and out of window trades. [10][14]
- No central bank money, no CCP, no default fund, no membership rules, no loss sharing waterfall, no supervisory oversight. [9][40]
- No legal framework: no netting opinions, no settlement finality statute, no insolvency treatment. In the real world those are what make PvP binding. [30][40]
- Atomicity on chain covers the exchange itself only. It does not protect against stablecoin depeg, issuer freeze, key theft, smart contract bugs, congestion, or a failed on ramp. [32][33]
- The "race" is pedagogical. Sequential pay-first settlement exposes the failure window; the atomic path does not. The window is real in FX (it existed from 1974 until CLS, and persists today for USD 2.2 trillion per day of trades), but in this demo the failure is simulated rather than caused by a counterparty default. [1][14]
- Money math follows the project convention: integer cents only, u64 in Rust, bigint in TypeScript, never floats.

### 7. Short lines ready for the educational page

- Sequential settlement: pay the first leg, then wait, then hope the second leg arrives.
- Herstatt, 26 June 1974: Deutsche marks paid in Frankfurt at 16:30, dollars never paid in New York, counterparties held the bag.
- The gap between the two legs is the exposure, and the clock creates the gap.
- PvP: my payment in one currency settles only if your payment in the other currency settles.
- CLS synchronizes both legs in one window and nets the funding, roughly 96 to 99 percent less cash than gross.
- Wire transfer: fast and final inside the operating day, but irrevocable and unconditional.
- Stablecoin settlement: 24/7, programmable, atomic because the transaction either commits or rolls back.
- Atomicity is not netting: all or nothing means you fund the whole trade every time.
- On chain, cash and the asset share a ledger, so delivery versus payment becomes one transaction instead of two infrastructures.
- Neither approach removes all risk. It decides which risk you carry.

### 8. Validation data (numbers with sources and uncertainty)

- 26 June 1974, 16:30 CET (10:30 a.m. New York): Herstatt closed. Source [1][2]. Confidence high.
- Herstatt was Germany's 35th largest bank in 1974. Source [2][3]. Confidence high.
- 1 July 1974: New York Clearing House recall procedure, payments not final until the next business day. Source [2] (Bank of England archive material). Confidence high.
- USD 2.2 trillion per day of FX turnover subject to settlement risk in April 2022, up from USD 1.9 trillion in April 2019. Source [14]. Confidence high, modelled estimate with a stated technical annex.
- FX turnover USD 7.5 trillion per day April 2022, USD 9.6 trillion per day April 2025. Source [15][16]. Confidence high.
- CLS operating since 9 September 2002, seven currencies at launch, 18 today. Source [23][11][43]. Confidence high.
- CLS daily payment value over USD 8.0 trillion (current), over USD 7.0 trillion average in 2024. Source [10][13]. Confidence medium to high, vendor reported, and payment value includes FX swaps so it is larger than trade notional.
- CLS netting savings 96 percent, up to 99 percent with in/out swaps, average funding about 1 percent (about USD 70 billion per typical day). Source [9][10][12]. Confidence medium, figures vary by method and by document date.
- USD 500 billion per day of same day FX volume not eligible for CLSSettlement. Source [12]. Confidence medium.
- CLS Americas Same Day Settlement Session for USD/CAD launched 23 September 2013 with 17 members. Source [22]. Confidence high.
- Fedwire Funds about USD 4.5 trillion per day 2024, average transfer about USD 5.4 million, hours 9:00 p.m. to 7:00 p.m. ET. Source [17][19]. Confidence high, with an announced 2025 hours expansion [20].
- CHIPS over USD 2 trillion per day (USD 2.014 trillion in 2024), about 95 percent of payments final in seconds, about USD 1 of funding per USD 26 settled. Source [18]. Confidence medium to high, operator reported.
- US securities moved to T+1 on 28 May 2024, Canada and Mexico on 27 May 2024. Source [29]. Confidence high.
- GENIUS Act, Public Law 119-27, enacted 18 July 2025, effective 18 January 2027, 1:1 reserves, monthly attested reports, permitted issuers only. Source [34][35]. Confidence high.
- BIS 2024 CBDC survey: 77 percent of respondents cite DvP, 71 percent cite PvP as a use case. Source [38]. Confidence high.
- Solana: all instructions succeed or the entire transaction fails and state changes revert; fees still charged on failure. Source [24][25]. Confidence high.

### 9. Relevant equations for the demo logic

- Herstatt style exposure over the failure window: Exposure = amount of leg 1 already paid and unrecovered, held from t1 (leg 1 final) to t2 (leg 2 final). If the counterparty fails inside (t1, t2), loss = Exposure. For the sequential path in this toy, loss = USD cents paid before failure.
- Atomic condition: Success = (leg 1 executed AND leg 2 executed). Failure implies full rollback, so post-failure state equals pre-trade state and Exposure = 0 for the exchange itself.
- Netting efficiency: for a member with gross obligations G in a currency and net obligation N, savings = 1 minus absolute(N) divided by G. CLS aggregates N across all members per currency per day, which is where the 96 to 99 percent saving comes from. The toy has N = G because it settles one trade in isolation.
- Race timing for the UI: winner is decided by wall clock to finality, sequential path total time = t1 plus failure or settlement delay, atomic path total time = one transaction confirmation.
- Money: all values are integer cents (u64 in Rust, bigint in TypeScript). Ratios should be computed with integer or decimal arithmetic and only formatted for display.

### 10. Citations

1. Wikipedia, "Herstatt Bank", mechanism, times, aftermath. https://en.wikipedia.org/wiki/Herstatt_Bank
2. B. Norman, Bank of England, Bank Underground, 24 June 2015, "BoE archives reveal little known lesson from the 1974 failure of Herstatt Bank". https://bankunderground.co.uk/2015/06/24/boe-archives-reveal-little-known-lesson-from-the-1974-failure-of-herstatt-bank/
3. ECB Financial Stability Review, December 2007, Box "More than thirty years after the Herstatt case, foreign exchange settlement risk is still an issue". https://www.ecb.europa.eu/press/financial-stability-publications/fsr/focus/2007/pdf/ecb~ccda416def.fsrbox200712_19.pdf
4. CPSS (BIS), March 1996, "Settlement risk in foreign exchange transactions". https://www.bis.org/cpmi/publ/d17.pdf
5. CPSS (BIS), July 1998, "Reducing foreign exchange settlement risk: a progress report". https://www.bis.org/publications/reducing-foreign-exchange-settlement-risk-progress-report.pdf
6. BCBS, September 2000, "Supervisory guidance for managing settlement risk in foreign exchange transactions" (cited in [3]).
7. CPSS (BIS), May 2008, "Progress in reducing foreign exchange settlement risk". https://www.bis.org/publications/progress-reducing-foreign-exchange-settlement-risk.pdf
8. BIS, "History of the Basel Committee on Banking Supervision". https://www.bis.org/committees/bcbs/history
9. CLS Group, "What are the necessary ingredients for any PvP arrangement to work?". https://www.cls-group.com/insights/the-fx-ecosystem/what-are-the-necessary-ingredients-for-any-pvp-arrangement-to-work
10. CLS Group, CLSSettlement product page (USD 8.0 trillion daily, 18 currencies, 96 percent funding reduction). https://www.cls-group.com/products/settlement/clssettlement
11. CLS Group, Currencies page (CAD is CLS eligible). https://www.cls-group.com/products/settlement/clssettlement/currencies/
12. CLS Group, March 2025, "Exploring the case for additional settlement cycles" (netting efficiency, same day FX volumes). https://www.cls-group.com/media/lnocyvna/cls_fna_report_reimagining_-sameday_fx_mar2025.pdf
13. CLS presentation to the Canadian Foreign Exchange Committee, Bank of Canada, October 2024 (PvP definition, USD 7 trillion daily, gross settlement with net funding). https://www.bankofcanada.ca/wp-content/uploads/2024/10/cls-presentation.pdf
14. BIS Quarterly Review, December 2022, "FX settlement risk: an unsettled issue" (USD 2.2 trillion at risk per day). https://www.bis.org/publications/qr-202212/fx-settlement-risk-unsettled-issue
15. BIS Triennial Central Bank Survey, October 2022 commentary (USD 7.5 trillion per day). https://www.bis.org/publications/202210-commentary-otc-derivatives
16. BIS Triennial Central Bank Survey, September 2025 commentary (USD 9.6 trillion per day). https://www.bis.org/publications/202509-commentary-otc-derivatives
17. Federal Reserve Banks, Fedwire Funds Service PFMI disclosure (2024 average daily value and average transfer value). https://www.frbservices.org/wp-content/uploads/funds-service-disclosure.pdf
18. The Clearing House, CHIPS product page (over USD 2 trillion daily, 95 percent final in seconds, USD 1 into USD 26). https://www.theclearinghouse.org/payment-systems/CHIPS
19. Federal Reserve Bank services, Fedwire Funds and National Settlement Service operating hours. https://www.frbservices.org/resources/financial-services/wires/fedwire-funds-service-national-settlement-service-operating-hours/
20. Federal Register, 17 November 2025, "Federal Reserve Action To Expand Fedwire Funds Service and National Settlement Service operating". https://www.federalregister.gov/documents/2025/11/17/2025-19942/federal-reserve-action-to-expand-fedwirer-funds-service-and-national-settlement-service-operating
21. Federal Reserve, "Fedwire Funds Transfer System: Assessment of Compliance with the Core Principles for Systemically Important Payment Systems" (RTGS, immediate finality). https://www.federalreserve.gov/paymentsystems/fedfunds_coreprinciples.htm
22. WatersTechnology, 23 September 2013, "CLS Debuts USD/CAD Same-Day Settlement". https://www.waterstechnology.com/trading-tech/2296231/cls-debuts-usdcad-same-day-settlement
23. Swiss National Bank, "The Continuous Linked Settlement foreign exchange settlement system" (September 2002 launch, operational timeline). https://www.snb.ch/dam/jcr:92bb643e-a03e-4970-a8ce-0dadae60b130/continuous_linked_settlement.en.pdf
24. Solana Documentation, "Transactions" (atomic execution, fees charged on failure). https://solana.com/docs/core/transactions
25. Solana Documentation, "Transaction Pipeline" (commit or rollback, all instructions revert on failure). https://solana.com/docs/core/transactions/transaction-pipeline
26. CPSS and IOSCO, November 2001, "Recommendations for Securities Settlement Systems". https://www.iosco.org/library/pubdocs/pdf/ioscopd123.pdf
27. CPSS (BIS), 1992, "Delivery versus payment in securities settlement systems" (CPSS Publications No. 6). https://www.bis.org/publications/delivery-versus-payment-securities-settlement-systems
28. Investopedia, "Delivery Versus Payment (DVP)" (plain language definition, secondary source). https://www.investopedia.com/terms/d/dvp.asp
29. US SEC, 28 May 2024, Chair Gensler statement on the T+1 settlement cycle. https://www.sec.gov/newsroom/press-releases/2024-62
30. ISDA, "Opinions Overview" (close out netting enforceability under ISDA Master Agreements). https://www.isda.org/opinions-overview/
31. New York Foreign Exchange Committee, "Guidelines for Foreign Exchange Settlement Netting" (bilateral netting can cut settlement exposure by up to about 60 percent). https://www.newyorkfed.org/medialibrary/microsites/fxc/files/guidefx.pdf
32. US Treasury, FDIC, OCC and the President's Working Group on Financial Markets, November 2021, "Stablecoins Report" (settlement finality, liquidity risk of 24/7 chains against banked on ramps, operational risk). https://home.treasury.gov/system/files/136/StableCoinReport_Nov1_508.pdf
33. FSB, 23 July 2024, "Cross-border Regulatory and Supervisory Issues of Global Stablecoin Arrangements in EMDEs". https://www.fsb.org/uploads/P230724.pdf
34. US Congress, GENIUS Act, S.1582, Public Law 119-27, enacted 18 July 2025. https://www.congress.gov/bill/119th-congress/senate-bill/1582
35. OCC Bulletin 2026-50, "GENIUS Act Regulations: Final Rule" (enactment date, permitted issuers, reserves). https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-50.html
36. Visa, "How stablecoins are reinventing cross-border payments" (24/7 case, ramp limitations, regulation, custody, depeg risk). https://www.visa.com/en-us/thought-leadership/global-money-movement/stablecoins-are-reinventing-cross-border-payments
37. BIS Innovation Hub, "Project Mariana" (cross border trading and settlement of wholesale CBDC using DeFi primitives, concluded 2024). https://www.bis.org/project/mariana
38. BIS, 2024, "Advancing in tandem: results of the 2024 BIS survey on central bank digital currencies and crypto" (77 percent DvP, 71 percent PvP). https://www.bis.org/publications/paper-159-advancing-tandem-results-2024-bis-survey-central-bank-digital-currencies-and-crypto
39. M. Herlihy, 2018, "Atomic Cross-Chain Swaps" (arXiv:1801.09515, HTLC style atomic swaps). https://arxiv.org/pdf/1801.09515
40. CPSS and IOSCO, April 2012, "Principles for Financial Market Infrastructures". https://www.bis.org/cpmi/publ/d101a.pdf
41. C. Schenk, 2014, "Summer in the City: Banking Failures of 1974 and the USD Liquidity Crisis", Economic History Review 129(4) (CHIPS suspension and 1974 contagion). https://academic.oup.com/ehr/article/129/540/1129/2769724
42. Federal Reserve Bank of New York, 2020, "Understanding FX Settlement Risk". https://www.newyorkfed.org/medialibrary/microsites/fxc/files/2020/FX_settlement_risk.pdf
43. Bank of Canada, J. Miller, "CLS Bank: Managing Foreign Exchange Settlement Risk" (CAD as an early CLS currency, Bank of Canada settlement account for CLS Bank). https://www.bankofcanada.ca/wp-content/uploads/2010/06/miller_e.pdf

### 11. Verification checklist

- [x] Findings come from central banks, standards bodies, operators, primary legislation, or peer reviewed work wherever possible.
- [x] Herstatt date, times, and leg direction verified against a Bank of England source, not only secondary blogs.
- [x] Numbers carry their date, scope, and a stated confidence level.
- [x] Operator reported CLS and CHIPS figures are labelled as vendor or operator reported.
- [x] The toy's gaps versus CLS are stated explicitly (no netting, no value dates, no central bank money, no legal finality).
- [x] All sources are listed with URLs in section 10.
- [ ] Open item: the CPSS 1992 DvP Type 1, Type 2, Type 3 taxonomy was not verified from a primary source in this pass, because the report is a PDF that could not be fetched. Do not publish the type taxonomy until it is checked against the original CPSS report.
- [ ] Open item: exact CLS pay-in deadline per currency varies by currency and by source (07:00 CET window start versus earlier funding deadline). Confirm against current CLS operational documentation before quoting a single deadline time.
- [ ] Open item: Fedwire Sunday and holiday hours expansion announced in 2025. Confirm the hours actually in force before quoting.
- [ ] Open item: whether CLS daily "value" figures quoted in marketing pages include FX swap legs, which would inflate them relative to trade notional. Use the phrase "payment value" when quoting.
- [ ] Not yet researched: precise regulatory references for Canada (Retail Payment Activities Act, Canadian Payments Act, and any designated payment system rules), and Canadian participation in CLS through the Bank of Canada settlement account as described by Miller [43]. Add if the README claims anything about Canadian rules.

## 2026-11-11 - Solana Request for Startups (9 Nov 2026): four AI and Consumer requests

Scope: research brief for the orchestrator on four of the eleven requests in the Solana Foundation Request for Startups published 9 November 2026 (https://solana.com/request-for-startups). The agent-facing guide at https://solana.com/request-for-startups.md returned HTTP 429 on every fetch attempt this pass, so brief details rest on the requester's supplied context plus secondary coverage (Solana Compass, crypto.news, web3news item IDs 480619/480620/480626). All claims web sourced unless marked memory.

### The requests as published (sourced)

- Eleven requests, four with Foundation speakers, each with video, thesis, "why now", "why Solana" and three starting points, plus an agent-facing markdown guide. Builder Program offers "grants, go-to-market support, builder tools, hiring help, and credits"; apply "once there is something to show"; a build challenge is announced but undated. Sources: https://solanacompass.com/news/solanas-new-request-for-startups-lists-11-ideas-from-housing-futures-to-ai-wallet-advisors , https://crypto.news/solana-11-startup-ideas-ai-stablecoins-housing-futures/
- "An open marketplace for AI inference" (Jacob Creech, VP Technology): one interface to independent providers, permissionless listing, verify which model handled a request, reputation, payment channels for usage. Verification is described as a separate system, not something Solana does natively. Source: https://web3news.kordislabs.io/item/480620/
- "An AI financial advisor in your wallet" (Rishin Sharma, Head of AI): understands holdings/goals, watches markets, explains moves, executes only with explicit approval. Source: https://crypto.news/solana-11-startup-ideas-ai-stablecoins-housing-futures/
- "Entertainment finance for everyone" (Pedro Miranda, Head of Consumer): "Acorns meets Pump and Fomo", one app joining everyday spending, financial habits and portfolio. Source: https://web3news.kordislabs.io/item/480619/
- "Game-day mode for prediction markets" (Kyle Samani, Chairman, Forward Industries): one live screen of a football fan's open positions across games plus discovery from held positions, explicitly built on existing trading and resolution layers. Source: https://web3news.kordislabs.io/item/480626/
- The agent guide tells agents to ask who the first user is, what ships in two weeks, which licences could block it, to recommend "the one with the clearest first user and smallest testable wedge", and not to call anything "legally compliant, custody-safe, or investment-ready without appropriate expert review". Source: Solana Compass (above).

### Request 1 - Open marketplace for AI inference

- How it works today: routers/gateways (OpenRouter: 600+ models, 80+ providers, 5.5% fee on Standard credit purchases and 8% on Business, no token markup; Vercel AI Gateway, Cloudflare AI Gateway, OrcaRouter, self-hosted LiteLLM). Posted-price aggregation (OpenRouter) versus on-chain reverse auction (Akash) are the two production price-discovery models. Sources: https://openrouter.ai/pricing , https://www.metergraph.dev/blog/2026/09/22/buying-inference/ , https://www.jaredwatkins.com/research/compute-marketplaces/
- Verification gap is real and unsolved: Akash settles on compute time and cannot tell whether the claimed model ran; "quality/fraud verification (a provider silently serving a more heavily quantized model than advertised) has no standard countermeasure yet". Sources: https://computeflux.ai/blogs/23-competitor-comparison/ , https://www.jaredwatkins.com/research/compute-marketplaces/
- Verification approaches: TEE remote attestation (5 to 10 percent overhead, needs NVIDIA H100-class GPU TEE because weights live in GPU memory), zkML (JSTprove live on Bittensor subnet 2/DSperse mainnet Jan 2026), optimistic (opML), statistical (SVIP). No universal standard as of April 2026. Sources: https://equilibrium.co/writing/state-of-verifiable-inference , https://gist.github.com/dcolley/6e98241f1662bb3ad45385535cde96fb , https://phemex.com/academy/what-is-verifiable-ai-cryptographic-proofs-blockchain
- Crowding signal: Mira "Sterling" beta launched 5 November 2026, routes only to providers passing five off-path checks, pays in USDC via x402, prices up to 50% below list; a four-month scan of 189 API endpoints found 37 undisclosed model or service changes across 29 endpoints. Source: https://www.kucoin.com/blog/mira-network-sterling-verified-ai-inference
- Solana presence: x402 (Linux Foundation x402 Foundation launched 14 July 2026, Solana Foundation a premier member), Solana Payment Channels (3 September 2026, Alibaba Cloud inference endpoints payable at launch), pay.sh endpoint directory, OpenDexter (5,000+ x402 endpoints with seller reputation), Gate402 (provider listing with signed wallet header, EVM payout), Hyre (agent services via x402 on Solana), ParallaxPay (x402 Solana Hackathon project with on-chain reputation), SAID and SATI agent identity/reputation, Solana AI ecosystem page listing Inference.net, Nosana, io.net, Render, Grass. Sources: https://payzum.com/blog/x402-ecosystem-2026/ , https://payzum.com/blog/solana-payment-channels-ai-agents/ , https://dexter.cash/press/dexter-open-x402-gateway , https://gate402.app/ , https://xona-agent.com/blog/state-of-agentic-commerce-on-solana , https://thesolanapulse.com/solana-ai-hub/
- Scale reality check: crypto-native providers served about 211B tokens/day on OpenRouter, roughly 1% of the platform's 21.9T/day; Artemis found about half of observed x402 transactions were artificial in early 2026; daily x402 volume was near $28,000 in March 2026. Sources: https://nitter.gq/BlockworksAdv/article/2110415412580020472 , https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet
- Named "Verto" as an inference marketplace could not be verified. Verto is an Arweave NFT marketplace (defunct trading) and a Solana DeFi tooling suite (vertodefi.com); vertoai.net is an institutional digital-asset operations platform. Treat "Verto" as unidentified.

### Request 2 - AI financial advisor in your wallet

- Compliance line (the binding constraint): personalized securities advice for compensation is "investment advice" under the Investment Advisers Act of 1940 regardless of whether a human or an agent delivers it; an AI cannot register or owe a fiduciary duty, obligations land on the deploying firm; internet investment adviser exemption was narrowed in 2024 with a 31 March 2025 compliance date; state versus SEC registration splits near $100M AUM. Sources: https://astraea.law/insights/ai-trading-agent-investment-adviser-registration , https://www.sec.gov/investment/im-guidance-2017-02.pdf
- Regulators are watching now: SEC 2027 examination priorities (published 10 November 2026) name automated investment advisory services, recommendations and trading algorithms, testing accuracy of AI representations, consistency with disclosures, and appropriateness of recommendations. FINRA and the SEC have said obligations do not change when GenAI produces recommendations. Sources: https://www.bakerdonelson.com/super-intelligence-deepfakes-and-cyberattacks-the-secs-2027-examination-priorities-put-ai-in-the-spotlight , https://www.debevoise.com/insights/publications/2025/10/agentic-ai-in-retail-investing-navigating-regulato
- Incumbents shipping in 2026: Robinhood Strategies about $2B and 300,000 funded customers by mid-2026; Betterment AI Account Recommender (March 2026); SoFi Coach (May 2026) and Composer strategy builder (June 2026, self-directed side, user approves rules); robo industry assets above $1.4 trillion; the common pattern is AI for explanation and user-authored automation, with the regulated act of recommendation kept human-designed or tightly supervised. Source: https://www.condorcapital.com/digital-advice-report/reports/robo-industry-2026-2q-2026/
- Consumer AI money apps: Cleo, Monarch, Magnifi (about $14/month), Origin, Betterment, Wealthfront; more than a third of consumers use Claude or ChatGPT for investment guidance. Source: https://www.moneyflock.com/contents/articles/best-ai-financial-advisor-apps
- Solana-native competition: WealthSmith (Solana, read-only, guidance, manual execution, guardrails on Jupiter/Raydium/Orca/Kamino/Meteora/Marinade/Jito), &milo (Solana autonomous portfolio manager with a trade diary, open beta Feb 2026), Raster (AI quant desk, approval-gated execution), Xavier, Ask Gina (Base/Solana/Arbitrum, Prelude and Coinbase Ventures), Lume (tokenized equities and perps on Solana with AI Autopilot). Sources: https://wealthsmith.ai/ , https://reviewnexa.com/milo-review/ , https://raster.finance/ , https://askxavier.ai/ , https://docs.lumefi.app/getting-started/readme
- The genuinely open piece for this builder is not advice, it is an auditable approval and action record: prior research on this project already flags agent trust (P and L journals, spending limits) as an open gap, and the Cornell Tech I-HITL study (Nov 2026) showed agents bypassing crypto spending limits without human approval.

### Request 3 - Entertainment finance for everyone

- How the industry works: eToro (2007, CopyTrader 2010, 35M users, Popular Investor pays 1.5% of copied assets per year, copy minimum $200), Stake (gamified onboarding, virtual wheel, free share), Cash App Investing (1,800+ stocks and ETFs, fractional, recurring orders, BTC only crypto), Robinhood. CFD platforms make money on spread and 70 to 80 percent of retail CFD accounts lose money. Sources: https://research.contrary.com/report/etoro , https://www.investorschronicle.co.uk/content/efd82e54-ab52-54f9-8e4e-e9bcbff37172 , https://www.businessinsider.com/personal-finance/investing/cash-app-investing-review
- Gamification is a regulated concern, not just a growth lever: FCA research (16 November 2022) found confetti, badges, leaderboards and push notifications associated with riskier trading, 1 in 27 survey participants with problem gambling behaviour versus 1 in 29 for online gamblers, and about 1 in 5 at-risk. Sources: https://www.fca.org.uk/publications/research-articles-fca-research/gaming-trading-how-trading-apps-could-be-engaging-consumers-worse , https://www.cfainstitute.org/sites/default/files/-/media/documents/article/industry-research/investment-gamification-implications.pdf
- Crypto copy trading is crowded and centralised: Bitget (leader, high-water-mark profit share, 50 USDT minimum), Binance, Bybit, OKX, BingX, eToro. Sources: https://www.bitget.com/academy/best-crypto-social-trading-platforms-review , https://coinbureau.com/analysis/top-crypto-copy-trading-platforms
- Solana presence is fresh and mobile-first: Sprouts won the $30K Solana Mobile CLOCK IN grand prize on 10 November 2026 for round-up savings of swap dust shown as a growing garden (659 teams, 11 winners, $135K total); Token.com social trading feed on Seeker; Amp Pay USDC with Visa card; Step Wallet one-click yield via Dialect Blinks; Polaris pay-in-4 credit and on-chain credit score; Perena yield-bearing stablecoin; Cashflow yield aggregator; a MagicBlock thread claims 22 entertainment-finance projects. Sources: https://solanacompass.com/news/solana-mobile-clock-in-hackathon-winners-sprouts-takes-30k-as-11-seeker-apps-split-135k , https://solanamobile.com/blog/5-seeker-dapps-you-need-to-try-right-now , https://blog.colosseum.com/seeker-seed-vault-wallet-squads-coinbase-step-wallet/
- Tokenized equities on Solana are arriving (Jito JTX opened tokenized stock trading 5 November 2026 per Solana Compass), which is the "traditional asset" half of the brief; issuing, custody and brokerage remain licensed activities.

### Request 4 - Game-day mode for prediction markets

- Existing front ends: Polymarket app (card-based discovery, portfolio tab grouped by category, resolution criteria inline), Kalshi app (live in-game trading, push notifications, same-game parlays on Monday Night Football since 30 September 2025, pro cross-market views with live P and L in one screen), Traderline (Betfair-style ladder, "My Predictions" positions panel, in-market live match statistics), Robinhood prediction markets mobile-only, Polymarket US parlays (up to 10 legs, public 21 August 2026). Sources: https://www.thelines.com/prediction-markets/polymarket/app/ , https://www.strafe.com/esports-betting/reviews/kalshi/app/ , https://nexteventhorizon.substack.com/p/kalshi-rolls-out-same-game-parlays , https://traderline.com/polymarket-user-guide , https://www.ingame.com/polymarket-us-launches-parlays/
- Solana venues and tooling: Jupiter Prediction Market API (beta) covers discovery, orderbook, live scores, positions, P and L, claims, profiles, leaderboards, `GET /events/suggested/{pubkey}` for discovery; Kalshi tokenized on Solana via Jupiter and DFlow from 1 December 2025; Jupiter brought Polymarket markets to Solana in February 2026; Jupiter Forecast (4 June 2026) is native with Prop AMM routing and Token-2022 outcome mints settling atomically in JupUSD; sports was about 80% of Jupiter Predict's record $2.9M week in June 2026. Sources: https://developers.jup.ag/docs/prediction , https://solanacompass.com/news/jupiter-launches-forecast-solanas-first-native-prediction-market-with-multi-market-maker-quoting , https://solanafloor.com/news/80-of-jupiter-predict-s-all-time-high-volume-comes-from-sports-trading , https://www.solanateams.com/blog/solana-prediction-markets-teams-jobs-investors-2026
- World launched inside Phantom 1 July 2026 and standalone at world.xyz on 9 September 2026 with more than 1 million waitlisted users, 150,000+ markets, every NFL regular-season game, Chainlink resolution, non-custodial SPL position tokens settled in CASH; about $12.7M volume in the 30 days to 20 October 2026 and more than $60M total per DefiLlama. Sources: https://genfinity.io/2026/09/10/world-xyz-solana-prediction-market-1-million-waitlist-chainlink/ , https://www.solanateams.com/blog/solana-prediction-markets-teams-jobs-investors-2026
- Drift BET availability could not be confirmed as of November 2026 after the 1 April 2026 incident; Hedgehog Markets has about $46,000 in deposits and no recent volume. Source: https://madeonsol.com/blog/solana-prediction-markets-guide , https://www.solanateams.com/blog/solana-prediction-markets-teams-jobs-investors-2026
- Solana-native front ends already chasing the same brief: Kickr (soccer signals on Polymarket liquidity, shipped in 15 days on Solana Mobile), PredictTok (TikTok-style feed over Jupiter markets), Foresee (social prediction market with accuracy tracking), Terrace added a game-day feature within days of Samani's post (every bet beside the live score plus markets on followed games). Sources: https://solanamobile.com/blog/solana-mobile-monolith-hackathon-winners-announced , nitter.rdrama.net search for @ElioCodes post (Nov 2026, unverified secondary)
- Sports data and licensing are the hard wall: the NFL on 27 August 2026 restored DraftKings/FanDuel/Fanatics deals and expressly excluded prediction markets from data and IP rights; Sportradar extended to Polymarket 20+ competitions and about 300,000 matches a year but never the NFL, and Sportradar developer terms prohibit use of its services for any prediction market without prior written consent; the NBA authorised prediction markets with a requirement to use official data for settlement; entry pricing ranges from $30 to $249/month self-serve odds APIs up to Sportradar from $1,250/month with production access by sales. Sources: https://igaming-times.com/news/sports-betting/the-nfl-brings-draftkings-and-fanduel-back-and-locks-out-prediction-markets , https://igaming-times.com/news/prediction-markets/sportradar-sells-polymarket-300-000-matches-a-year-and-the-nfl-is-not-one , https://developer.sportradar.com/sportradar-updates/page/terms-and-conditions , https://www.lsports.eu/blog/sports-data-cost , https://www.legalsportsreport.com/285853/sportradar-us-revenue-jumps-47-driven-by-prediction-markets/
- Polymarket builder obligations for anyone building a front end: disclose your own fees, maintain sanctions and AML controls, use provided geoblocking, exclude Restricted Persons, do not resell data to capital-markets firms. Source: https://builders.polymarket.com/code-of-conduct
- Resolution gap (prior research, refined with new data): 3,005 UMA disputes on 2,666 Polymarket markets from 1 January to 2 October 2026; 853 of 2,543 settled disputed markets (33.5%) settled differently from the disputed proposal; 0.38% of 143,286 markets resolved March 2025 to August 2026 hit a formal dispute (about 1 in 263), rising to 1.45% above $100,000 volume; dispute rate fell from 1.90% of traded markets in March 2025 to 0.06% in August 2026 while contested volume reached $3.64B (6.2% of UMA-resolved volume). Sources: https://data.predge.io/benchmark , https://bullpenbrief.com/how-often-do-polymarket-markets-end-in-dispute-we-analyzed-143000/ , https://fidonis.org/integrity/polymarket/2026-11/
- Correction to the 2026-11-10 entry: the "1,150+ UMA disputes in 5 months" figure carried earlier is not reproduced by these sources. Use the dated figures above with their windows instead.

### Hackathon facts (verified 11 November 2026)

- "Perps and Prediction Markets" at hackathons.solana.com: deadline 5 December 2026, $100,000 main track (1st $50,000, 2nd $30,000, 3rd $20,000), $1,000 sponsor bounty for best use of the PREDICT pm-AMM judged on traction with real on-chain users, why the pm-AMM, narrative, integration depth, product today, standalone potential; 590 registered at time of reading. Source: https://hackathons.solana.com/hackathons/perps-and-prediction-markets
- PREDICT pm-AMM: open-source Paradigm pm-AMM on Solana, one program with 26 instructions, USDC collateral, binary YES/NO, commitment vaults, TypeScript SDK `@pm-amm/sdk`, 266 tests, mainnet, MIT; explicitly asks builders to solve resolution honestly ("Today the resolution authority picks the winner. Tell users who resolves your markets and how"). Sources: https://metadao.fi/companies/predict , https://metadao.com/decisions/predict-002
- A third-party page records an earlier 2 October 2026 submission close for a Perps and Prediction Markets round; confirm which round the 5 December 2026 deadline belongs to before planning against it. Source: https://metadao.fi/companies/predict

### Practical implications for this builder

- Request 4 is the highest fit: it matches the Dec 5 hackathon theme, the existing React and integer-cents skillset, and the resolution gap already established as the sharpest open gap on Solana; the shortest wedge is a game-day cockpit over the Jupiter Prediction API with RPC websocket position subscriptions.
- Request 1 is a payment and reputation build, not a verification build: ship signed usage receipts and per-provider reputation accounts in u64 integer cents over x402 or Payment Channels, and never claim model execution verification without naming a TEE or ZK system.
- Request 2 is blocked at the core for an unregulated solo builder: personalized advice for compensation needs registered investment adviser status (or a partner RIA/broker-dealer); the buildable wedge is an approval-gated, provenance-logged action journal that explains holdings and never uses advisory language.
- Request 3 is the lowest fit for the hackathon (off-theme) and the most crowded and licensed: round-up savings plus a leaderboard is buildable, but the "traditional asset investing" half needs a broker-dealer or tokenized-equity partner and gamification draws FCA-style scrutiny.
- Tooling note for implementation: the Request for Startups names `@solana/react-hooks`, but framework-kit marks that package no longer maintained in favour of `@solana/react`, and the Foundation's own solana-dev-skill says not to use `@solana/client`/`@solana/react-hooks` for new work. Use `@solana/kit`, `@solana/react`, `@solana/kit-plugin-wallet` and `@solana/keychain`.

### Benchmark data available for tester

- Jupiter Prediction API beta endpoints for a game-day fixture: `GET /positions`, `GET /events/scores`, `GET /events/suggested/{pubkey}`, `GET /profiles/{ownerPubkey}/pnl-history`.
- UMA dispute base rates with windows (Predge, BullpenBrief, Fidonis) for any resolution-quality claims in the demo.
- x402 volume caveats (Artemis about half artificial) so any "marketplace" claim stays honest.

### Open items

- [ ] `https://solana.com/request-for-startups.md` returned HTTP 429 on every attempt this pass; fetch the four briefs' exact "Starting points" and tooling lists before writing any page that quotes them verbatim.
- [ ] "Verto" as an inference marketplace is unidentified; confirm with requester.
- [ ] Confirm whether the 5 December 2026 hackathon is the same round as the 2 October 2026 close recorded on the PREDICT page.
- [ ] OpenRouter ownership: one secondary briefing refers to a Stripe acquisition of OpenRouter; another reports a Series B at about $1.3B in May 2026. Do not state ownership without a primary source.
- [ ] Terrace's game-day feature announcement rests on a nitter mirror of a single X post; verify before citing as a competitor.

## 2026-11-11 - Solana Request for Startups: housing futures, exotic collectibles, attention tokens, startup discovery

Scope: research brief for the orchestrator on the remaining four of the eleven requests in the Solana Foundation Request for Startups published 9 November 2026 (https://solana.com/request-for-startups), for a solo Anchor/Rust/TypeScript devnet builder who will only build unregulated products (devnet demos or partner with licensed entities), with a 5 December 2026 hackathon deadline plus longer-term startup interest. The official page and its agent guide (https://solana.com/request-for-startups.md) returned HTTP 429 on every fetch this pass, so brief text rests on the search index copy of the page plus secondary coverage (Solana Compass, crypto.news, capwolf, chaingridnews, web3news items 480627 and 480629). All claims web sourced unless marked memory.

### The requests as published (sourced)

- "Onchain housing futures" (Matty Taylor, Colosseum, Markets): perpetual market on a metropolitan housing index, homeowner hedge versus buyer exposure. Starting points as indexed: choose one city and define an index with reliable licensed data; design the market for both homeowners and people saving to buy; prototype liquidity, collateral and oracle behavior before expanding. Source: https://solana.com/request-for-startups (via search index), https://solanacompass.com/news/solanas-new-request-for-startups-lists-11-ideas-from-housing-futures-to-ai-wallet-advisors
- "Bring exotic collectibles onchain" (Vibhu Norby, CPO, Solana Foundation, Tokenization): authenticated custody, asset records, transferable ownership token, physical redemption for art, cars, coins, antiques, watches. Suggested starting point: one collectible category with authentication and vaulting first, marketplace and pricing tools after. Norby on X 9 Nov 2026: collectibles are small next to equities but an easy crypto onboarding with a proven business model. Sources: https://crypto.news/solana-11-startup-ideas-ai-stablecoins-housing-futures/ , https://chaingridnews.com/2026/11/09/solana-publishes-11-startup-ideas-across-ai-and-payments/
- "Attention tokens for startup distribution" (Farhaj Mayan, Forma, Distribution): founder launches a token with no company ownership, a market on how much attention it can drive; trading revenue goes into a wallet that can only fund marketing; vetted creators bid for campaign budget, payments and results visible. Sources: https://web3news.kordislabs.io/item/480629/ , https://crypto.news/solana-11-startup-ideas-ai-stablecoins-housing-futures/
- "Discovery and trading for onchain startup fundraising" (Adam Bergeman, Star.fun, Markets): investor discovery surfacing founder track record, shipped products, repository activity, with AI organizing the evidence; brief cites recent SEC signals as friendlier for onchain startup raises; wedge described as early-stage crypto utility projects expanding to angel investors. Source: https://web3news.kordislabs.io/item/480627/
- Builder Program: grants, go-to-market support, builder tools, hiring help, credits; apply "once there is something to show"; build challenge announced, undated. Sources: Solana Compass (above), https://crypto.news/solana-11-startup-ideas-ai-stablecoins-housing-futures/

### Request A - Onchain housing futures

- CME S&P/Case-Shiller housing futures launched May 2006 (10 metros plus composite, contract unit $250 times the index, financially settled). Options permanently delisted 25 February 2020 with zero open interest, futures put on a reduced listing schedule (CME notice SER-8519, 27 January 2020). Sources: https://www.cmegroup.com/notices/ser/2020/01/SER-8519.html , https://omen.trade/blog/case-shiller-housing-futures
- Volume history: about 2,935 housing contracts traded in all of 2007 versus 2.2 billion contracts on CME that year; open interest averaged 1,583 contracts in the first nine months of 2008; annual volume across all regions averaged about 175 contracts since 2010; May 2026 contract showed zero open interest in June 2026; WSJ listed NYMX26 with volume 0 and open interest N/A in October 2026. Sources: Jud and Winkler, "The Housing Futures Market", Journal of Real Estate Practice and Education 17(2) 2009, https://home.uncg.edu/~juddon/documents/JudandWinklerPageProofs.pdf , https://www.homepricefutures.com/posts/s-p-cme-case-shiller-futures-approach-15th-anniversary , https://sccgmanagement.com/sccg-articles/2026/06/06/real-estate-prediction-markets-the-worlds-largest-asset-class-meets-its-first-real-trading-instrument/ , https://www.wsj.com/market-data/quotes/futures/NYMX26/contracts
- Earlier failures: FOX (London) listed four real estate futures in May 1991, discontinued October 1991 after wash trade volume padding per Shiller; HedgeStreet housing "hedgelets" launched October 2004, halted for lack of popularity; Radar Logic (residential index derivatives) collapsed around the GFC. Sources: Jud and Winkler (above), https://housingnotes.com/p/investing-in-bettor-housing
- Why it failed (consensus): one sided flow (hedgers with no speculative counterparties), market makers could not lay off risk in any correlated liquid market so bid-ask stayed wide, basis risk between an individual home and a metro repeat-sales index, contract complexity and futures brokerage/margin requirements for retail, low awareness, index lag of roughly two to three months (three-month moving average window). Sources: Jud and Winkler, homepricefutures.com 15th anniversary post, sccgmanagement.com
- Index licensing: S&P Dow Jones Indices licenses indices to more than 550 financial institutions for ETFs, futures, options and structured products; S&P Global terms bar creating commercial products or revenue generating use from derived data without permission; FRED reproduces Case-Shiller series with an explicit prohibition on reproduction without prior written permission. Source: https://www.spglobal.com/spdji/en/about-us/data-index-licensing/ , https://www.spglobal.com/content/dam/spglobal/corporate/en/documents/Corp_0324_licensingtermsconditionsamericas.pdf , https://fred.stlouisfed.org/graph/?id=SPCS10RNSA . Memory claim, not verified this pass: the FHFA House Price Index is a US government publication generally usable without a license, which is the obvious unlicensed alternative data source.
- Onchain attempts: Parcl (founded 2020, raised 11.6M USD plus from Archetype, Dragonfly, ParaFi, Coinbase Ventures, Solana Ventures and others) runs real estate perps on Solana with a proprietary Parcl Labs price per square foot index delivered through Pyth, once daily around 7:45 to 7:50 AM ET, USDC collateral, up to 10x leverage. Parcl V4 launched October 2026 on its own Parcl Chain with a bridge from Solana, invite-only closed alpha, eight US housing markets, order book model. Sources: https://defillama.com/rwa/platform/parcl , https://solanacompass.com/projects/parcl , https://docs.v4.parcl.co/trading/oracle , https://blog.parcl.co/articles/intro-to-parcl
- Prediction market path is where the volume actually went: Polymarket launched real estate prediction markets on 5 January 2026 in partnership with Parcl, more than 100 active housing markets and more than 45M USD cumulative volume by late May 2026, binary contracts on monthly, quarterly and yearly index direction with small minimum sizes and no margin accounts. Source: sccgmanagement.com (above)
- Licensing and regulation for an unregulated solo builder: a real product needs (a) an index data license or a public domain or self built index, (b) a regulated venue for leveraged retail derivatives (CFTC registered exchange or a partner such as Kalshi or Polymarket US), (c) market surveillance (the brief itself flags it), (d) custody and clearing for customer collateral. None of this is a coding problem.

### Request B - Bring exotic collectibles onchain

- Fractional retail collectibles investing (the securities version) failed as a category: Rally (RSE Markets) operated in app secondary trading until 20 November 2021, the SEC settled charges on 12 July 2023 for operating an unregistered exchange (more than 55,000 secondary transactions worth about 5.8M USD among 20,000 plus investors, 350,000 USD penalty); secondary trading wound down 2024; Form 1-K for fiscal 2025 filed 7 May 2026 carries going concern language, a 10.3M USD accumulated deficit at the parent and 235,364 USD cash across 360 series; Rally announced a pivot in July 2026 to bundle assets into an NYSE listed vehicle called PIKA. Otis sold to Public in a fire sale, Collectable shut in 2023 with litigation (Gangl v. Neuman, S.D.N.Y. 2024, plus a Delaware books and records win in May 2025), Vint pivoted to HNW clients. Sports Illustrated called fractional sports card investing "a total failure" in November 2024. Sources: https://www.sec.gov/newsroom/press-releases/2023-132 , https://investalternative.com/reviews/rally-review , https://alternativeassets.substack.com/p/lets-mourn-rally , https://www.si.com/collectibles/news/fractional-investing-in-sports-cards-has-been-a-failure
- Root causes: Reg A or Reg D securities structure with thin weekly trading windows that never produced price discovery, carry costs (storage, insurance, legal, staff) against flat NAVs, frontloaded sourcing fees (about 5 to 20 percent), single company acting as manager, custodian and marketplace with no deep pockets behind it. Sources: ideaproof.io failure page, investalternative.com, alternativeassets.substack.com
- What works today in the non securities 1:1 model: auction houses and specialist dealers (Christie's, Sotheby's, Chrono24 charging about 6.5 percent), grading services (PSA, BGS), insured vaulting (Malca-Amit, Brink's). Crypto venues: Kettle (Blast) vaults watches in NYC, mints an NFT as the withdrawal key, 2.5 percent sales fee; Courtyard (Polygon); Beezie moved from Flow to Base to Solana (Solana expansion announced 12 May 2026, more than 540,000 claw pulls and more than 100M USD cumulative Base volume) and on 3 September 2026 announced a Luxury Closet deal putting authenticated handbags, watches and jewellery on Solana in Brink's vaults with redemption or buyback at up to 92 percent of fair market value, go live late 2026; Phygitals (Solana mainnet) binds 1:1 to cards held with PSA, Fanatics or Alt vault partners and retires the token on redemption; Fragment and The Artisan (Solana) tokenized watches with Civic KYC; Port66 lists Solana plans. Sources: https://www.kettle.finance/vault , https://alearesearch.substack.com/p/kettle-luxury-watch-rwa-trading-what , https://www.cryptotimes.io/2026/09/03/hermes-birkins-head-to-solana-in-beezie-luxury-closet-deal/ , https://www.cryptoninjas.net/news/solana-lands-5b-luxury-tokenization-deal-for-birkin-bags-rolex-and-chanel-pieces/ , https://docs.phygitals.com/phygitals/technology-overview , https://www.rwaf.xyz/ecosystem/tokenized-collectibles/
- Gap: the token, registry, provenance and settlement layer is commodity software now and genuinely open to a solo builder; the hard and capital heavy parts are authentication, insurance, custody, shipping and fraud, which are operations businesses. Fractional shares of a collectible are securities (Rally's 350,000 USD lesson). High ticket resale brings KYC and AML expectations that Beezie's own luxury deal does not publish.
- Solana tooling fit: Token-2022 extensions (MetadataPointer, PermanentDelegate, NonTransferable, Default Account State), Token ACL (sRFC37, permissionless thaw with a gate program, https://solana.com/docs/tokenization/token-acl), Solana DvP program (released 6 October 2026, MIT license, J.P. Morgan input, Cantina audit with all four medium findings fixed, deployed on mainnet and devnet, docs at https://solana.com/docs/tokenization/dvp state it has no order book, no KYC and no off chain cash leg), Solana Attestation Service (credential, schema, attestation, tokenized soulbound attestations using seven Token-2022 extensions, https://solana.com/docs/tools/attestations/overview and https://github.com/solana-foundation/solana-attestation-service), Actions and Blinks (https://solana.com/docs/actions), payments and RPC.

### Request C - Attention tokens for startup distribution

- Conventional startup distribution economics: seed marketing budgets run about 7,400 to 45,500 USD per month with a midpoint near 21,700 USD; seed SaaS guidance is 15 to 25 percent of the raise over 12 to 18 months (150,000 to 250,000 USD on a 1M raise); channel costs per acquired customer are about 2 to 20 USD owned email, 15 to 60 USD referral credits, 120 to 450 USD paid search, 180 to 700 USD LinkedIn ads, 150 USD typical referral CAC; budget discipline is two or three tests of 1,000 to 3,000 USD each with written kill criteria. Sources: https://www.shilikajain.com/blog/seed-stage-marketing-budget-template , https://www.scalixai.com/blog/seed-stage-marketing-budget-guide , https://startupcustomeracquisition.com/what-goes-into-startup-customer-acquisition-cost-by-channel , https://scalegrowth.digital/resources/strategy/marketing-budget-guide-startups/
- Prior attention tokens: Basic Attention Token (Brave) shipped at real scale (reported 70M to 93M MAU, 1.8M verified creators, 3,500 ad campaigns) but creator payouts stayed negligible, the automatic attention based contribution was removed in 2023 in favor of manual tipping, and KYC withdrawal friction (Uphold, Gemini) locked small balances. Sources: https://slightfuture.com/blog/brave-payments/ , https://blockmap.one/blog/basic-attention-token-bat-how-brave-is-building-an-economy-around-the-brave-attention-economy/ , https://tensquared.com/research/research-25-09-the-attention-economy-web3's-next-frontier-for-growth-and-innovation.html
- Closest prior art to the exact brief: Loud ($LOUD, Solana, launched 31 May 2025 via HoloLaunch, raised 400 SOL for 45 percent supply) collects trading fees from its Meteora pool into a Mindshare Pool described as a marketing budget, pays 80 percent of weekly fees to the top 25 yappers scored by Kaito and 20 percent to KAITO stakers. It markets itself, not third party startups. Source: https://nftevening.com/what-is-loud-loud-airdrop-guide/
- Adjacent attention markets: Kaito Yaps (post to earn, sunsetting announced January 2026), Kaito plus Polymarket Attention Markets announced February 2026 with rollout in March 2026 (mindshare and sentiment questions, pilot markets above 1.3M USD), Noise (mindshare perps using Kaito as oracle, invite only), Multicoin's "Attention Oracles" thesis (October 2025). A secondary source claims Zora launched attention markets on Solana in February 2026; unverified, treat as low confidence. Sources: https://www.coingecko.com/learn/what-is-kaito-earn-yap-points , https://crypto.com/en/research/infofi-jun-2025 , https://alearesearch.substack.com/p/noise-making-mindshare-tradable-what , https://multicoin.capital/2025/10/23/building-the-attention-economy/ , https://cryptoprocent.com/what-is-the-attention-economy-in-crypto/
- Gap and risk: the specific loop (third party startup token, trading revenue to a marketing restricted treasury, vetted creators bidding for campaign budget, no equity) is barely tried and is the genuinely open part. Failure modes: attention measurement needs an oracle (Kaito dependency or self reported metrics that get gamed), wash trading inflates the treasury inflow narrative, and a token sold to fund the startup or marketed as capturing its success is a securities question (Howey), which is why the brief insists on no ownership.
- Unregulated slice: a devnet or play money attention market where the treasury can only pay USDC to wallets holding a vetted creator attestation is ordinary commerce plus tooling, no license needed. Selling the token to the public to raise capital would need issuer counsel and an exemption (Reg CF, Reg A or similar), which is outside this builder's constraint.

### Request D - Discovery and trading for onchain startup fundraising

- How investors diligence today: solo angels spend 8 to 12 hours over one to three weeks (screen, founder interviews, reference calls, market and financial review, legal scan); tools are Crunchbase, PitchBook, LinkedIn, GitHub, SEC EDGAR Form D, Product Hunt, court records; VC first pass memos went from two or three days to two or three hours with AI over 15 plus sources; GitHub commit cadence by week over 12 weeks, contributor growth and new repo clusters are the standard public signals, with known traps (squash merges, bots, self declared authorship, star gravity). Sources: https://ddr.bio/blog/due-diligence-checklist , https://mentionfox.com/for-vc-due-diligence-teams , https://valueaddvc.com/blog/how-ai-is-changing-the-vc-research-and-due-diligence-process , https://gitdealflow.com/blog/github-due-diligence-checklist-20-minutes , https://www.refolk.ai/guides/startup-engineering-team-signal-reference.md
- Onchain equivalents so far: Star.fun (born February 2025 after a failed pump.fun launch, raised 450,000 USD in 48 hours in June 2025, earned 300,000 USD in trading fees, helped three teams raise 1.1M USD, livestreamed raises with Meteora pools, refunds on missed targets, vesting on unsold supply, plans AI review of founder GitHub code, two Wyoming LLCs OpCo and TokenCo DAO); pump.fun, Believe (tweet to launch on Solana, 2 percent trade tax split 1 percent creator, 0.1 percent scout, 0.9 percent ops, 6.3M USD fees in one day at peak May 2025), DAOs.fun (stopped launching new funds 21 April 2026, founder said users only wanted to speculate and managers sold tokens after raises), MetaDAO, Jupiter Studio, Jupiter Studio style curated launches. Sources: https://star.fun/about , https://blockworks.com/news/starfun-vc-capital , https://solanacompass.com/projects/believe-app , https://solanacompass.com/projects/daosfun , https://madeonsol.com/compare-launchpads , https://blog.ape.store/believe-alternatives/
- Discovery today is social feeds and chart sites, not evidence dossiers: no equivalent of Crunchbase or PitchBook exists for onchain startup tokens; Star.fun itself says apps are built on social feeds that do not surface founder track record, recent GitHub commits or past achievements; AI organized evidence is explicitly the requested wedge. Sources: https://web3news.kordislabs.io/item/480627/ , web2 diligence sources above
- Compliance line: a research and discovery tool is data aggregation and publishing, no custody, no order matching, no advice, so it fits an unregulated solo builder if it (a) does not match orders or take customer funds (that is exchange or broker territory, the Rally precedent), (b) does not present itself as investment advice, and (c) links out to existing venues for any trade (Actions and Blinks to Jupiter or a launchpad). The brief's own thesis depends on continued SEC friendliness toward onchain startup raises, which is a market assumption, not a fact to build on.

### Ranking for this builder and partner flags

- Primary ranking (startup fit under the unregulated constraint): 1 Discovery and trading (High), 2 Exotic collectibles (High), 3 Attention tokens (Medium), 4 Housing futures (Low).
- Hackathon adjustment: prior research identified the 5 December 2026 deadline as the Colosseum "Perps and Prediction Markets" track (100,000 USD main track, PREDICT pm-AMM sponsor bounty, https://hackathons.solana.com/hackathons/perps-and-prediction-markets). If that is the target event, housing futures is the best theme match (it literally is a perp and the brief asks to prototype liquidity, collateral and oracle behavior) while discovery is the best startup bet. Confirm the track with the requester.
- Fundamentally unbuildable without a licensed partner: housing futures, yes, core thesis. Partner types needed: an index data licensor (S&P Dow Jones Indices, or Parcl Labs, or build from public domain FHFA data), a CFTC registered derivatives venue or regulated partner (CME, Kalshi, Polymarket US), a market surveillance provider (exchange in house or a vendor such as Nasdaq SMARTS, memory claim on the vendor name), and an FCM or custodian for customer collateral.
- Collectibles: partially blocked. Token, registry, provenance and DvP layers are buildable solo; production needs an insured vault and authenticator partner (Brink's, Malca-Amit class), and any fractional share structure needs an SEC registered funding portal or broker-dealer.
- Attention tokens: conditionally buildable. Unblocked if the token raises no money and pays no returns (devnet or play money); blocked if the token sale funds the startup or is marketed as capturing its success, which needs issuer counsel and an exemption filing.
- Discovery and trading: not blocked, provided the product does not operate a matching engine, hold customer funds, or give personalized advice.

### Tooling map for wedges (official Solana toolkit)

- Markets and trading: https://solana.com/docs/defi and the PREDICT pm-AMM (https://metadao.fi/companies/predict) for any binary market wedge; Parcl V4 docs as a reference design for daily oracle perps (https://docs.v4.parcl.co).
- Token-2022 extensions: https://spl.solana.com/token-2022/extensions , anchor-spl token_2022_extensions.
- Token ACL: https://solana.com/docs/tokenization/token-acl (sRFC37, gate program, permissionless thaw).
- Delivery versus payment: https://solana.com/docs/tokenization/dvp (record, fund, settle; settlement authority signs; deadlines enforced; no KYC, no order book).
- Attestations: https://solana.com/docs/tools/attestations (credential, schema, attestation, tokenized soulbound form).
- Actions and Blinks: https://solana.com/docs/actions ; payments: https://solana.com/docs/payments ; RPC: https://solana.com/docs/rpc .

### Open items

- [ ] https://solana.com/request-for-startups and .md returned 429 all pass; fetch exact "Starting points" and tooling lists for the four briefs before quoting them verbatim.
- [ ] Confirm the 5 December 2026 hackathon track (perps and prediction markets assumed from the 2026-11-11 AI and Consumer entry).
- [ ] FHFA House Price Index public domain status is a memory claim; verify before using it as the unlicensed index in any demo write up.
- [ ] Nasdaq SMARTS as surveillance vendor is a memory claim.
- [ ] Zora attention markets on Solana (February 2026) rests on one secondary aggregator; verify against Cointelegraph or skip.
