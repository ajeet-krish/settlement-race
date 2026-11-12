/**
 * Anchor devnet implementation of the ProgramClient interface.
 *
 * The client wraps one Anchor `Program` built from the committed IDL copy
 * (`settlement_race.json`, refreshed from `anchor build` output) and maps
 * every interface method onto the matching instruction. Signing is role
 * based:
 *
 * - `driver` and `partyB` are in-memory `Signer` keypairs (engine and
 *   scripted bot) partial signed per transaction.
 * - `wallet` is the wallet-adapter signer (party A). It is the Anchor
 *   provider wallet, so it pays and signs every transaction; instructions
 *   signed by the driver or the bot additionally carry that keypair's
 *   signature.
 *
 * Every submit funnels through one send helper instead of
 * `Program.methods().rpc()`: the helper compiles the transaction with a
 * blockhash fetched before send, partial signs it with the authority
 * keypair and the wallet, sends it with `sendRawTransaction`, and confirms
 * with the explicit blockhash strategy
 * `connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight })`,
 * which polls the RPC rather than opening a websocket signature
 * subscription. Transport failures inside that chain are normalized to
 * typed `Code: message` errors, so a submit always resolves to a TxResult
 * and never to a rejection escaping the await chain.
 *
 * Program error strings are formatted `<ErrorName>: <message>` (for example
 * `NotParty: Signer is not an authorized party for this scenario`), the same
 * convention the offline mock uses, so callers and tests can parse the code
 * out of a failed TxResult without special casing each client. Failures that
 * are not program errors keep the same shape with a typed code: a missing
 * account read (inside a submit or from a direct fetch) is
 * `AccountNotFound: ...` and any other RPC shaped failure is `RpcError: ...`.
 */

import {
    AnchorError,
    AnchorProvider,
    BN,
    Program,
    ProgramError,
} from "@anchor-lang/core";
import {
    PublicKey,
    SystemProgram,
    Transaction,
    VersionedTransaction,
} from "@solana/web3.js";
import type {
    BlockhashWithExpiryBlockHeight,
    Commitment,
    Connection,
    Signer,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idlJson from "./settlement_race.json";
import type { SettlementRace } from "./settlementRaceTypes";
import {
    PROGRAM_ID,
    chainHeadPda,
    scenarioPda,
    vaultCadPda,
    vaultUsdPda,
} from "./pda";
import type {
    AckArgs,
    AdvanceClockArgs,
    AnchorChainHeadArgs,
    DeclareDefaultArgs,
    FetchResult,
    FundLegArgs,
    InitScenarioArgs,
    MarkFailedArgs,
    ProgramClient,
    ReleaseLeg2PartialArgs,
    ReleaseLegArgs,
    ScenarioAccount,
    SettleAtomicArgs,
    StartRaceArgs,
    TxResult,
} from "./programClient";
import type { LifecycleState, SettlementPathName } from "./ticket";

/**
 * Wallet signer shape. Structurally identical to Anchor's `Wallet`
 * interface and to `AnchorWallet` from `@solana/wallet-adapter-react`, so a
 * connected wallet can be passed straight from `useAnchorWallet()`.
 */
export interface AnchorWallet {
    publicKey: PublicKey;
    signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
    signAllTransactions<T extends Transaction | VersionedTransaction>(
        txs: T[],
    ): Promise<T[]>;
}

/** Decoded on-chain ChainHead account (extension beyond ProgramClient). */
export interface ChainHeadAccount {
    scenario: PublicKey;
    /** 32 byte head hash of the provenance chain. */
    final_hash: Uint8Array;
    event_count: bigint;
    anchored_unix_ts: bigint;
    anchored_virtual_ms: bigint;
    bump: number;
}

export interface AnchorClientOptions {
    connection: Connection;
    /** Program id; defaults to the id declared in the IDL. */
    programId?: PublicKey;
    /** USD mint, legacy SPL token with 2 decimals. */
    usdMint: PublicKey;
    /** CAD mint, legacy SPL token with 2 decimals. */
    cadMint: PublicKey;
    /** Driver (engine) keypair; signs every driver-only instruction. */
    driver: Signer;
    /** Party B (scripted bot) keypair; signs the leg 2 payments. */
    partyB: Signer;
    /** Party A wallet (wallet adapter); provider wallet and fee payer. */
    wallet: AnchorWallet;
    commitment?: Commitment;
}

/** Wrap an in-memory keypair as an Anchor wallet for headless callers. */
export function keypairWallet(keypair: Signer): AnchorWallet {
    const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
        if (tx instanceof Transaction) {
            tx.partialSign(keypair);
        } else {
            tx.sign([keypair]);
        }
        return tx;
    };
    return {
        publicKey: keypair.publicKey,
        signTransaction: async <T extends Transaction | VersionedTransaction>(
            tx: T,
        ): Promise<T> => sign(tx),
        signAllTransactions: async <T extends Transaction | VersionedTransaction>(
            txs: T[],
        ): Promise<T[]> => txs.map(sign),
    };
}

/** Resolved signing authority for one public key. */
type Authority = { kind: "keypair"; signer: Signer } | { kind: "wallet" };

/**
 * Minimal structural view of an Anchor methods builder: enough to compile
 * the transaction for the polling send path and to fall back onto the
 * provider send when no blockhash can be anchored. Keeps one private
 * helper usable across every instruction type without naming each generic
 * instantiation.
 */
interface SubmitBuilder {
    signers(signers: Signer[]): unknown;
    /** Provider backed send and confirm, used only without a blockhash. */
    rpc(): Promise<string>;
    /** Compile the configured instruction into an unsigned transaction. */
    transaction(): Promise<Transaction>;
}

/** Decoded Scenario account as returned by the Anchor coder. */
type ScenarioDecoded = Awaited<
    ReturnType<Program<SettlementRace>["account"]["scenario"]["fetch"]>
>;

/** Decoded ChainHead account as returned by the Anchor coder. */
type ChainHeadDecoded = Awaited<
    ReturnType<Program<SettlementRace>["account"]["chainHead"]["fetch"]>
>;

/** Party public keys stored on a Scenario account. */
interface PartyKeys {
    party_a: PublicKey;
    party_b: PublicKey;
}

/** IDL error code to name map for ProgramError formatting. */
const PROGRAM_ERROR_NAMES: ReadonlyMap<number, string> = new Map(
    idlJson.errors.map((entry) => [entry.code, entry.name]),
);

/** Map the decoded RaceStatus enum onto the shared lifecycle strings. */
function decodeStatus(status: ScenarioDecoded["status"]): LifecycleState {
    if ("new" in status) {
        return "NEW";
    }
    if ("ack" in status) {
        return "ACK";
    }
    if ("paying" in status) {
        return "PAYING";
    }
    if ("settled" in status) {
        return "SETTLED";
    }
    if ("defaulted" in status) {
        return "DEFAULTED";
    }
    return "FAILED";
}

/** Map the decoded SettlementPath enum onto the ticket path names. */
function decodePath(path: ScenarioDecoded["path"]): SettlementPathName {
    return "sequential" in path ? "SEQUENTIAL" : "ATOMIC";
}

/** True when a message already carries a `Code: message` prefix. */
function hasTypedCode(message: string): boolean {
    return /^[A-Za-z][A-Za-z0-9]*: /.test(message);
}

/**
 * Give a plain (non program) failure the shared `Code: message` shape:
 * account fetch failures inside a submit (a missing scenario or chain
 * head account read by the builder) become `AccountNotFound: ...`, and
 * anything else RPC shaped becomes `RpcError: ...`. Messages that already
 * carry a code pass through untouched.
 */
function withTypedCode(message: string): string {
    if (hasTypedCode(message)) {
        return message;
    }
    if (/account does not exist|account not found|accountnotfound/i.test(message)) {
        return `AccountNotFound: ${message}`;
    }
    return `RpcError: ${message}`;
}

/** Convert a failed transaction into the shared `Code: message` string. */
function formatTxError(err: unknown): string {
    if (err instanceof AnchorError) {
        return `${err.error.errorCode.code}: ${err.error.errorMessage}`;
    }
    if (err instanceof ProgramError) {
        const name = PROGRAM_ERROR_NAMES.get(err.code) ?? String(err.code);
        return `${name}: ${err.msg}`;
    }
    if (err instanceof Error) {
        return withTypedCode(err.message);
    }
    return withTypedCode(String(err));
}

/**
 * Format an account fetch failure (missing account, bad discriminator) with
 * the same `Code: message` typing the mock client uses, so both clients
 * surface identical error shapes for the same failure: not-found wording
 * becomes `AccountNotFound: ...` and anything else `RpcError: ...`.
 */
function formatFetchError(err: unknown): string {
    if (err instanceof Error) {
        return withTypedCode(err.message);
    }
    return withTypedCode(String(err));
}

export class AnchorClient implements ProgramClient {
    private readonly program: Program<SettlementRace>;
    private readonly programId: PublicKey;
    private readonly usdMint: PublicKey;
    private readonly cadMint: PublicKey;
    private readonly wallet: AnchorWallet;
    /** RPC connection used for blockhash, send, and polling confirmation. */
    private readonly connection: Connection;
    /** Commitment for blockhash reads and transaction confirmation. */
    private readonly commitment: Commitment;
    private readonly keypairs = new Map<string, Signer>();
    /** Party keys per scenario, filled at init and refreshed on fetch. */
    private readonly partyKeys = new Map<string, PartyKeys>();
    /**
     * Lane path registered by initScenario. The frozen StartRaceArgs carries
     * no path, so start_race replays the path the lane was created with; a
     * scenario this client never initialized must be registered through
     * registerLanePath first instead of silently defaulting to sequential.
     */
    private readonly lanePaths = new Map<string, SettlementPathName>();

    constructor(options: AnchorClientOptions) {
        this.programId = options.programId ?? PROGRAM_ID;
        this.usdMint = options.usdMint;
        this.cadMint = options.cadMint;
        this.wallet = options.wallet;
        this.connection = options.connection;
        this.commitment = options.commitment ?? "confirmed";
        this.keypairs.set(options.driver.publicKey.toBase58(), options.driver);
        this.keypairs.set(options.partyB.publicKey.toBase58(), options.partyB);

        const provider = new AnchorProvider(
            options.connection,
            options.wallet,
            {
                ...AnchorProvider.defaultOptions(),
                commitment: this.commitment,
            },
        );
        // The Program reads its program id from the IDL address field, so a
        // caller supplied id overrides that one field at construction.
        const runtimeIdl = {
            ...(idlJson as unknown as SettlementRace),
            address: this.programId.toBase58(),
        } as SettlementRace;
        this.program = new Program(runtimeIdl, provider) as Program<SettlementRace>;
    }

    /** Program id this client submits transactions to. */
    get programAddress(): PublicKey {
        return this.programId;
    }

    /**
     * Extension (beyond ProgramClient): record the settlement path of a lane
     * this client did not initialize, for example after a page reload, so
     * startRace can replay it.
     */
    registerLanePath(scenario: PublicKey, path: SettlementPathName): void {
        this.lanePaths.set(scenario.toBase58(), path);
    }

    async initScenario(args: InitScenarioArgs): Promise<TxResult> {
        const authority = this.authorityFor(args.driver);
        if (authority === null) {
            return this.noAuthority(args.driver);
        }
        const [scenario] = scenarioPda(args.driver, args.scenario_id, this.programId);
        const [vaultUsd] = vaultUsdPda(scenario, this.programId);
        const [vaultCad] = vaultCadPda(scenario, this.programId);
        try {
            const builder = this.program.methods
                .initializeScenario(
                    new BN(args.scenario_id.toString()),
                    Array.from(args.ticket_hash),
                    new BN(args.leg1_usd_cents.toString()),
                    new BN(args.leg2_cad_cents.toString()),
                    new BN(args.gap_ms.toString()),
                )
                .accountsStrict({
                    scenario,
                    driver: args.driver,
                    usdMint: this.usdMint,
                    cadMint: this.cadMint,
                    vaultUsd,
                    vaultCad,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .remainingAccounts([
                    { pubkey: args.party_a, isSigner: false, isWritable: false },
                    { pubkey: args.party_b, isSigner: false, isWritable: false },
                ]);
            const signature = await this.send(builder, authority);
            this.rememberLane(scenario, args);
            return { ok: true, signature };
        } catch (err) {
            return { ok: false, error: formatTxError(err) };
        }
    }

    async ack(args: AckArgs): Promise<TxResult> {
        return this.submit(args.signer, () =>
            this.program.methods
                .acknowledge()
                .accountsStrict({ scenario: args.scenario, signer: args.signer }),
        );
    }

    async fundLeg(args: FundLegArgs): Promise<TxResult> {
        const leg = args.leg === "LEG1_USD" ? { leg1Usd: {} } : { leg2Cad: {} };
        const mint = args.leg === "LEG1_USD" ? this.usdMint : this.cadMint;
        const partyAta = getAssociatedTokenAddressSync(mint, args.signer);
        return this.submit(args.signer, () =>
            this.program.methods
                .fundLeg(leg, new BN(args.amount_cents.toString()))
                .accountsStrict({
                    scenario: args.scenario,
                    signer: args.signer,
                    partyAta,
                    vaultUsd: vaultUsdPda(args.scenario, this.programId)[0],
                    vaultCad: vaultCadPda(args.scenario, this.programId)[0],
                    tokenProgram: TOKEN_PROGRAM_ID,
                }),
        );
    }

    async startRace(args: StartRaceArgs): Promise<TxResult> {
        const path = this.lanePaths.get(args.scenario.toBase58());
        if (path === undefined) {
            return {
                ok: false,
                error:
                    "BadState: settlement path unknown for this scenario; " +
                    "initialize it through this client or call registerLanePath first",
            };
        }
        const pathArg = path === "SEQUENTIAL" ? { sequential: {} } : { atomic: {} };
        return this.submit(args.signer, () =>
            this.program.methods
                .startRace(pathArg)
                .accountsStrict({ scenario: args.scenario, signer: args.signer }),
        );
    }

    async releaseLeg1(args: ReleaseLegArgs): Promise<TxResult> {
        return this.submit(args.signer, async () => {
            const parties = await this.partiesFor(args.scenario);
            return this.program.methods
                .releaseLeg1()
                .accountsStrict({
                    scenario: args.scenario,
                    signer: args.signer,
                    vaultUsd: vaultUsdPda(args.scenario, this.programId)[0],
                    partyBAta: getAssociatedTokenAddressSync(
                        this.usdMint,
                        parties.party_b,
                    ),
                    tokenProgram: TOKEN_PROGRAM_ID,
                });
        });
    }

    async releaseLeg2(args: ReleaseLegArgs): Promise<TxResult> {
        return this.submit(args.signer, async () => {
            const parties = await this.partiesFor(args.scenario);
            return this.program.methods
                .releaseLeg2()
                .accountsStrict({
                    scenario: args.scenario,
                    signer: args.signer,
                    vaultCad: vaultCadPda(args.scenario, this.programId)[0],
                    partyAAta: getAssociatedTokenAddressSync(
                        this.cadMint,
                        parties.party_a,
                    ),
                    tokenProgram: TOKEN_PROGRAM_ID,
                });
        });
    }

    async releaseLeg2Partial(args: ReleaseLeg2PartialArgs): Promise<TxResult> {
        return this.submit(args.signer, async () => {
            const parties = await this.partiesFor(args.scenario);
            return this.program.methods
                .releaseLeg2Partial(new BN(args.amount_cents.toString()))
                .accountsStrict({
                    scenario: args.scenario,
                    signer: args.signer,
                    vaultCad: vaultCadPda(args.scenario, this.programId)[0],
                    partyAAta: getAssociatedTokenAddressSync(
                        this.cadMint,
                        parties.party_a,
                    ),
                    tokenProgram: TOKEN_PROGRAM_ID,
                });
        });
    }

    async declareDefault(args: DeclareDefaultArgs): Promise<TxResult> {
        return this.submit(args.signer, async () => {
            const parties = await this.partiesFor(args.scenario);
            return this.program.methods
                .declareDefault()
                .accountsStrict({
                    scenario: args.scenario,
                    signer: args.signer,
                    vaultCad: vaultCadPda(args.scenario, this.programId)[0],
                    partyBAta: getAssociatedTokenAddressSync(
                        this.cadMint,
                        parties.party_b,
                    ),
                    tokenProgram: TOKEN_PROGRAM_ID,
                });
        });
    }

    async settleAtomic(args: SettleAtomicArgs): Promise<TxResult> {
        return this.submit(args.signer, async () => {
            const parties = await this.partiesFor(args.scenario);
            return this.program.methods
                .settleAtomic()
                .accountsStrict({
                    scenario: args.scenario,
                    signer: args.signer,
                    vaultUsd: vaultUsdPda(args.scenario, this.programId)[0],
                    vaultCad: vaultCadPda(args.scenario, this.programId)[0],
                    partyBAta: getAssociatedTokenAddressSync(
                        this.usdMint,
                        parties.party_b,
                    ),
                    partyAAta: getAssociatedTokenAddressSync(
                        this.cadMint,
                        parties.party_a,
                    ),
                    tokenProgram: TOKEN_PROGRAM_ID,
                });
        });
    }

    async markFailed(args: MarkFailedArgs): Promise<TxResult> {
        return this.submit(args.signer, () =>
            this.program.methods
                .markFailed(args.reason ?? "")
                .accountsStrict({ scenario: args.scenario, signer: args.signer }),
        );
    }

    async advanceClock(args: AdvanceClockArgs): Promise<TxResult> {
        return this.submit(args.signer, () =>
            this.program.methods
                .advanceClock(new BN(args.to_ms.toString()))
                .accountsStrict({ scenario: args.scenario, signer: args.signer }),
        );
    }

    async anchorChainHead(args: AnchorChainHeadArgs): Promise<TxResult> {
        const chainHead = chainHeadPda(args.scenario, this.programId)[0];
        return this.submit(args.signer, () =>
            this.program.methods
                .anchorChainHead(
                    Array.from(args.final_hash),
                    new BN(args.event_count.toString()),
                    new BN(args.anchored_virtual_ms.toString()),
                )
                .accountsStrict({
                    scenario: args.scenario,
                    driver: args.signer,
                    chainHead,
                    systemProgram: SystemProgram.programId,
                }),
        );
    }

    async fetchScenario(scenario: PublicKey): Promise<FetchResult<ScenarioAccount>> {
        try {
            const raw = await this.program.account.scenario.fetch(scenario);
            const value = decodeScenario(raw);
            this.partyKeys.set(scenario.toBase58(), {
                party_a: value.party_a,
                party_b: value.party_b,
            });
            return { ok: true, value };
        } catch (err) {
            return { ok: false, error: formatFetchError(err) };
        }
    }

    /**
     * Extension (beyond ProgramClient): read the ChainHead PDA written by
     * anchor_chain_head, used by the anchor verification flow and the
     * evidence panel.
     */
    async fetchChainHead(scenario: PublicKey): Promise<FetchResult<ChainHeadAccount>> {
        try {
            const address = chainHeadPda(scenario, this.programId)[0];
            const raw = await this.program.account.chainHead.fetch(address);
            return { ok: true, value: decodeChainHead(raw) };
        } catch (err) {
            return { ok: false, error: formatFetchError(err) };
        }
    }

    /** Resolve the signing authority for a public key, or null when absent. */
    private authorityFor(signer: PublicKey): Authority | null {
        const keypair = this.keypairs.get(signer.toBase58());
        if (keypair !== undefined) {
            return { kind: "keypair", signer: keypair };
        }
        if (signer.equals(this.wallet.publicKey)) {
            return { kind: "wallet" };
        }
        return null;
    }

    private noAuthority(signer: PublicKey): TxResult {
        return {
            ok: false,
            error: `NotParty: no signing authority registered for ${signer.toBase58()}`,
        };
    }

    /** Run a builder factory: resolve the signer, send, and map errors. */
    private async submit(
        signer: PublicKey,
        build: () => SubmitBuilder | Promise<SubmitBuilder>,
    ): Promise<TxResult> {
        const authority = this.authorityFor(signer);
        if (authority === null) {
            return this.noAuthority(signer);
        }
        try {
            const builder = await build();
            const signature = await this.send(builder, authority);
            return { ok: true, signature };
        } catch (err) {
            return { ok: false, error: formatTxError(err) };
        }
    }

    /**
     * Send a prepared builder with the authority applied.
     *
     * One helper for every instruction submit: compile the transaction with
     * a blockhash fetched before send, partial sign it with the authority
     * keypair and the wallet, send it with `sendRawTransaction`, then
     * confirm with the explicit blockhash strategy, which polls the RPC for
     * status instead of subscribing to the signature over a websocket. Any
     * failure inside the chain (blockhash read, wallet, send, confirmation,
     * expiry) is rethrown as a typed `Code: message` error, so the caller's
     * catch always yields a TxResult and nothing escapes the await chain as
     * an unhandled rejection.
     */
    private async send(
        builder: SubmitBuilder,
        authority: Authority,
    ): Promise<string> {
        try {
            const blockhash = await this.confirmBlockhash();
            if (blockhash === null) {
                // The connection cannot anchor a confirmation strategy, so
                // delegate to the provider send, which resolves its own
                // blockhash and reports failures through the same typed
                // errors.
                if (authority.kind === "keypair") {
                    builder.signers([authority.signer]);
                }
                return builder.rpc();
            }
            const tx = await builder.transaction();
            tx.feePayer = tx.feePayer ?? this.wallet.publicKey;
            // Always re-set from the fresh read: a blockhash pre-set on the
            // transaction could come from a different read than the
            // lastValidBlockHeight below, which would break the pairing the
            // confirmation strategy relies on.
            tx.recentBlockhash = blockhash.blockhash;
            if (authority.kind === "keypair") {
                tx.partialSign(authority.signer);
            }
            const signed = await this.wallet.signTransaction(tx);
            const signature = await this.connection.sendRawTransaction(
                signed.serialize(),
                { preflightCommitment: this.commitment },
            );
            const confirmation = await this.connection.confirmTransaction(
                {
                    signature,
                    blockhash: blockhash.blockhash,
                    lastValidBlockHeight: blockhash.lastValidBlockHeight,
                },
                this.commitment,
            );
            if (confirmation.value.err) {
                throw new Error(
                    `Raw transaction ${signature} failed (${JSON.stringify(confirmation.value.err)})`,
                );
            }
            return signature;
        } catch (err) {
            if (err instanceof AnchorError || err instanceof ProgramError) {
                throw err;
            }
            // Everything else is transport or client shaped: give it the
            // shared `Code: message` form so the caller formats one
            // TxResult shape for every failure.
            throw new Error(formatTxError(err));
        }
    }

    /**
     * Recent blockhash and expiry height for the polling confirmation.
     *
     * A connection that cannot supply one at all (a stub or partial
     * transport without blockhash reads) yields null, so the caller
     * delegates the send to the provider, which resolves its own blockhash
     * before sending. A real RPC failure is rethrown instead: it becomes a
     * typed `RpcError` result rather than a drop back onto a websocket
     * confirmation.
     */
    private async confirmBlockhash(): Promise<BlockhashWithExpiryBlockHeight | null> {
        if (typeof this.connection.getLatestBlockhash !== "function") {
            return null;
        }
        return await this.connection.getLatestBlockhash(this.commitment);
    }

    /**
     * Party keys for a scenario, cached from initScenario or refreshed with
     * one account fetch. Throws the fetch error when the account is missing.
     */
    private async partiesFor(scenario: PublicKey): Promise<PartyKeys> {
        const cached = this.partyKeys.get(scenario.toBase58());
        if (cached !== undefined) {
            return cached;
        }
        const result = await this.fetchScenario(scenario);
        if (!result.ok) {
            throw new Error(result.error);
        }
        return { party_a: result.value.party_a, party_b: result.value.party_b };
    }

    /** Remember everything initScenario knows about a new lane. */
    private rememberLane(scenario: PublicKey, args: InitScenarioArgs): void {
        this.partyKeys.set(scenario.toBase58(), {
            party_a: args.party_a,
            party_b: args.party_b,
        });
        // The program stores a Sequential placeholder until start_race; the
        // requested path is remembered client side for that call.
        this.lanePaths.set(scenario.toBase58(), args.path);
    }
}

/** Project the decoded coder shape onto the shared ScenarioAccount type. */
function decodeScenario(raw: ScenarioDecoded): ScenarioAccount {
    return {
        driver: raw.driver,
        party_a: raw.partyA,
        party_b: raw.partyB,
        ticket_hash: Uint8Array.from(raw.ticketHash),
        status: decodeStatus(raw.status),
        path: decodePath(raw.path),
        leg1_usd_cents: BigInt(raw.leg1UsdCents.toString()),
        leg2_cad_cents: BigInt(raw.leg2CadCents.toString()),
        funded_usd_cents: BigInt(raw.fundedUsdCents.toString()),
        funded_cad_cents: BigInt(raw.fundedCadCents.toString()),
        paid_cad_cents: BigInt(raw.paidCadCents.toString()),
        ack_a: raw.ackA,
        ack_b: raw.ackB,
        virtual_now_ms: BigInt(raw.virtualNowMs.toString()),
        race_started_at_ms: BigInt(raw.raceStartedAtMs.toString()),
        leg1_released_at_ms: BigInt(raw.leg1ReleasedAtMs.toString()),
        gap_ms: BigInt(raw.gapMs.toString()),
        scenario_id: BigInt(raw.scenarioId.toString()),
        bump: raw.bump,
    };
}

/** Project the decoded coder shape onto the shared ChainHeadAccount type. */
function decodeChainHead(raw: ChainHeadDecoded): ChainHeadAccount {
    return {
        scenario: raw.scenario,
        final_hash: Uint8Array.from(raw.finalHash),
        event_count: BigInt(raw.eventCount.toString()),
        anchored_unix_ts: BigInt(raw.anchoredUnixTs.toString()),
        anchored_virtual_ms: BigInt(raw.anchoredVirtualMs.toString()),
        bump: raw.bump,
    };
}
