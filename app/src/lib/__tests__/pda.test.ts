import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
    PROGRAM_ID,
    chainHeadPda,
    scenarioPda,
    vaultCadPda,
    vaultUsdPda,
} from "../pda";

const DRIVER_A = Keypair.generate().publicKey;
const DRIVER_B = Keypair.generate().publicKey;

describe("scenarioPda", () => {
    it("derives a deterministic address with a valid bump for the same seeds", () => {
        const [first, bump1] = scenarioPda(DRIVER_A, 1n);
        const [second, bump2] = scenarioPda(DRIVER_A, 1n);
        expect(first.toBase58()).toBe(second.toBase58());
        expect(bump1).toBe(bump2);
        expect(Number.isInteger(bump1)).toBe(true);
        expect(bump1).toBeGreaterThanOrEqual(0);
        expect(bump1).toBeLessThanOrEqual(255);
        expect(first.toBytes()).toHaveLength(32);
    });

    it("gives a different address when the driver or scenario id changes", () => {
        const [base] = scenarioPda(DRIVER_A, 1n);
        const [otherDriver] = scenarioPda(DRIVER_B, 1n);
        const [otherId] = scenarioPda(DRIVER_A, 2n);
        expect(otherDriver.toBase58()).not.toBe(base.toBase58());
        expect(otherId.toBase58()).not.toBe(base.toBase58());
    });

    it("accepts the full u64 scenario id range and rejects outside it", () => {
        expect(() => scenarioPda(DRIVER_A, 0n)).not.toThrow();
        expect(() => scenarioPda(DRIVER_A, 0xFFFFFFFFFFFFFFFFn)).not.toThrow();
        expect(() => scenarioPda(DRIVER_A, -1n)).toThrow(/u64 range/);
        expect(() => scenarioPda(DRIVER_A, 0x10000000000000000n)).toThrow(
            /u64 range/,
        );
    });
});

describe("vault and chain head PDAs", () => {
    it("derives distinct PDAs per account kind and per scenario", () => {
        const [scenario1] = scenarioPda(DRIVER_A, 1n);
        const [scenario2] = scenarioPda(DRIVER_A, 2n);

        const usd1 = vaultUsdPda(scenario1)[0];
        const cad1 = vaultCadPda(scenario1)[0];
        const head1 = chainHeadPda(scenario1)[0];
        const kinds = [usd1, cad1, head1].map((key) => key.toBase58());
        expect(new Set(kinds).size).toBe(3);

        const usd2 = vaultUsdPda(scenario2)[0];
        expect(usd2.toBase58()).not.toBe(usd1.toBase58());

        // Bumps are valid PDA bumps too.
        expect(vaultUsdPda(scenario1)[1]).toBeGreaterThanOrEqual(0);
        expect(vaultUsdPda(scenario1)[1]).toBeLessThanOrEqual(255);
    });
});

describe("PROGRAM_ID consistency", () => {
    it("keeps PROGRAM_ID in sync with declare_id! and Anchor.toml", () => {
        const libRs = readFileSync(
            new URL("../../../../programs/settlement-race/src/lib.rs", import.meta.url),
            "utf8",
        );
        const declared = /declare_id!\("([^"]+)"\)/.exec(libRs);
        expect(declared).not.toBeNull();
        expect(declared?.[1]).toBe(PROGRAM_ID.toBase58());

        const anchorToml = readFileSync(
            new URL("../../../../Anchor.toml", import.meta.url),
            "utf8",
        );
        const tomlId = /settlement_race = "([1-9A-HJ-NP-Za-km-z]+)"/.exec(
            anchorToml,
        );
        expect(tomlId).not.toBeNull();
        expect(tomlId?.[1]).toBe(PROGRAM_ID.toBase58());
    });

    it("derives PDAs against the declared program id by default", () => {
        const [address] = scenarioPda(DRIVER_A, 7n, PROGRAM_ID);
        const [explicit] = scenarioPda(
            DRIVER_A,
            7n,
            new PublicKey(PROGRAM_ID.toBase58()),
        );
        expect(address.toBase58()).toBe(explicit.toBase58());
    });
});
