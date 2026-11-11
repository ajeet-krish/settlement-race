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
