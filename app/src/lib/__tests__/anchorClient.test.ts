import { describe, expect, it, vi } from "vitest";
import { BN, BorshAccountsCoder } from "@anchor-lang/core";
import type { Idl } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { AccountInfo, Connection } from "@solana/web3.js";
import { AnchorClient, keypairWallet } from "../anchorClient";
import { PROGRAM_ID } from "../pda";
import { programErrorCode } from "../mockClient";
import idlJson from "../settlement_race.json";

const TICKET_HASH = new Uint8Array(32).fill(7);
const USD_MINT = Keypair.generate().publicKey;
const CAD_MINT = Keypair.generate().publicKey;

function connectionWithAccount(
    account: AccountInfo<Buffer> | null,
): Connection {
    return {
        getAccountInfoAndContext: vi.fn(async () => ({
            value: account,
            context: { slot: 1 },
        })),
    } as unknown as Connection;
}

async function encodeScenario(): Promise<AccountInfo<Buffer>> {
    const coder = new BorshAccountsCoder(idlJson as unknown as Idl);
    const data = await coder.encode("Scenario", {
        driver: Keypair.generate().publicKey,
        party_a: Keypair.generate().publicKey,
        party_b: Keypair.generate().publicKey,
        ticket_hash: Array.from(TICKET_HASH),
        status: { Settled: {} },
        path: { Atomic: {} },
        leg1_usd_cents: new BN(1000000),
        leg2_cad_cents: new BN(1350000),
        funded_usd_cents: new BN(1000000),
        funded_cad_cents: new BN(1350000),
        paid_cad_cents: new BN(0),
        ack_a: true,
        ack_b: true,
        virtual_now_ms: new BN(7000),
        race_started_at_ms: new BN(1000),
        leg1_released_at_ms: new BN(0),
        gap_ms: new BN(5000),
        scenario_id: new BN(42),
        bump: 200,
    });
    return { data, owner: PROGRAM_ID, executable: false, lamports: 2_000_000 };
}

interface ClientHarness {
    client: AnchorClient;
    driver: Keypair;
    partyB: Keypair;
    wallet: Keypair;
}

function makeClient(connection: Connection): ClientHarness {
    const driver = Keypair.generate();
    const partyB = Keypair.generate();
    const wallet = Keypair.generate();
    const client = new AnchorClient({
        connection,
        usdMint: USD_MINT,
        cadMint: CAD_MINT,
        driver,
        partyB,
        wallet: keypairWallet(wallet),
    });
    return { client, driver, partyB, wallet };
}

describe("AnchorClient: construction and account decoding", () => {
    it("exposes the program id it was built for", () => {
        const { client } = makeClient(connectionWithAccount(null));
        expect(client.programAddress.equals(PROGRAM_ID)).toBe(true);
    });

    it("decodes a Scenario account into the shared ScenarioAccount shape", async () => {
        const connection = connectionWithAccount(await encodeScenario());
        const { client } = makeClient(connection);
        const [scenario] = PublicKey.findProgramAddressSync(
            [Buffer.from("scenario"), client.programAddress.toBytes()],
            client.programAddress,
        );
        // The PDA above is only an address placeholder for the fetch; the
        // fake connection returns the encoded account for any address.
        const result = await client.fetchScenario(scenario);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const account = result.value;
        expect(account.status).toBe("SETTLED");
        expect(account.path).toBe("ATOMIC");
        expect(account.leg1_usd_cents).toBe(1000000n);
        expect(account.leg2_cad_cents).toBe(1350000n);
        expect(account.funded_usd_cents).toBe(1000000n);
        expect(account.paid_cad_cents).toBe(0n);
        expect(account.ack_a).toBe(true);
        expect(account.ack_b).toBe(true);
        expect(account.virtual_now_ms).toBe(7000n);
        expect(account.race_started_at_ms).toBe(1000n);
        expect(account.gap_ms).toBe(5000n);
        expect(account.scenario_id).toBe(42n);
        expect(account.bump).toBe(200);
        expect(Array.from(account.ticket_hash)).toEqual(Array.from(TICKET_HASH));
        expect(account.driver).toBeInstanceOf(PublicKey);
        expect(account.party_a).toBeInstanceOf(PublicKey);
    });

    it("reports a missing account as a fetch error", async () => {
        const { client } = makeClient(connectionWithAccount(null));
        const [scenario] = PublicKey.findProgramAddressSync(
            [Buffer.from("scenario"), client.programAddress.toBytes()],
            client.programAddress,
        );
        const result = await client.fetchScenario(scenario);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("does not exist");
        }
    });
});

describe("AnchorClient: signer authority guards", () => {
    it("rejects a signer with no registered authority before any network call", async () => {
        const { client } = makeClient(connectionWithAccount(null));
        const stranger = Keypair.generate().publicKey;
        const [scenario] = PublicKey.findProgramAddressSync(
            [Buffer.from("scenario"), client.programAddress.toBytes()],
            client.programAddress,
        );

        const ack = await client.ack({ scenario, signer: stranger });
        expect(ack.ok).toBe(false);
        if (!ack.ok) {
            expect(programErrorCode(ack.error)).toBe("NotParty");
        }

        const init = await client.initScenario({
            driver: stranger,
            party_a: stranger,
            party_b: Keypair.generate().publicKey,
            scenario_id: 1n,
            ticket_hash: TICKET_HASH,
            path: "SEQUENTIAL",
            leg1_usd_cents: 1n,
            leg2_cad_cents: 1n,
            gap_ms: 1n,
        });
        expect(init.ok).toBe(false);
        if (!init.ok) {
            expect(programErrorCode(init.error)).toBe("NotParty");
        }
    });

    it("refuses start_race for a lane whose path was never registered", async () => {
        const { client, driver } = makeClient(connectionWithAccount(null));
        const [scenario] = PublicKey.findProgramAddressSync(
            [Buffer.from("scenario"), client.programAddress.toBytes()],
            client.programAddress,
        );
        const result = await client.startRace({
            scenario,
            signer: driver.publicKey,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("settlement path unknown");
        }
    });

    it("registerLanePath clears the path gate for restored lanes", async () => {
        const { client } = makeClient(connectionWithAccount(null));
        const [scenario] = PublicKey.findProgramAddressSync(
            [Buffer.from("scenario"), client.programAddress.toBytes()],
            client.programAddress,
        );
        client.registerLanePath(scenario, "ATOMIC");
        // The path gate now passes, so the next rejection is the signer
        // authority check instead of the unknown path error.
        const stranger = Keypair.generate().publicKey;
        const result = await client.startRace({
            scenario,
            signer: stranger,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).not.toContain("settlement path unknown");
            expect(programErrorCode(result.error)).toBe("NotParty");
        }
    });
});

describe("AnchorClient: typed error codes for non program failures", () => {
    it("prefixes a fetch failure inside submit with AccountNotFound", async () => {
        const { client, driver } = makeClient(connectionWithAccount(null));
        const [scenario] = PublicKey.findProgramAddressSync(
            [Buffer.from("scenario"), client.programAddress.toBytes()],
            client.programAddress,
        );

        // releaseLeg1 resolves the party keys on demand, so the builder
        // throws mid submit when the scenario account is missing.
        const result = await client.releaseLeg1({
            scenario,
            signer: driver.publicKey,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/^AccountNotFound: /);
            expect(result.error).toContain("does not exist");
        }
    });

    it("keeps a program style code it already has", async () => {
        const { client } = makeClient(connectionWithAccount(null));
        const stranger = Keypair.generate().publicKey;
        const [scenario] = PublicKey.findProgramAddressSync(
            [Buffer.from("scenario"), client.programAddress.toBytes()],
            client.programAddress,
        );
        const result = await client.releaseLeg1({ scenario, signer: stranger });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            // NotParty comes back from the authority guard with its code
            // intact, never re-prefixed.
            expect(programErrorCode(result.error)).toBe("NotParty");
        }
    });
});

describe("keypairWallet", () => {
    it("partial signs legacy transactions for the keypair public key", async () => {
        const keypair = Keypair.generate();
        const wallet = keypairWallet(keypair);
        expect(wallet.publicKey.equals(keypair.publicKey)).toBe(true);

        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: keypair.publicKey,
                lamports: 1,
            }),
        );
        tx.feePayer = keypair.publicKey;
        tx.recentBlockhash = Keypair.generate().publicKey.toBase58();

        const signed = await wallet.signTransaction(tx);
        expect(signed.verifySignatures()).toBe(true);
        expect(signed.signatures[0]?.publicKey.equals(keypair.publicKey)).toBe(true);
    });

    it("signs every transaction in a batch", async () => {
        const keypair = Keypair.generate();
        const wallet = keypairWallet(keypair);
        const makeTx = (): Transaction => {
            const tx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: keypair.publicKey,
                    lamports: 1,
                }),
            );
            tx.feePayer = keypair.publicKey;
            tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
            return tx;
        };
        const signed = await wallet.signAllTransactions([makeTx(), makeTx()]);
        expect(signed).toHaveLength(2);
        for (const tx of signed) {
            expect(tx.verifySignatures()).toBe(true);
        }
    });
});
