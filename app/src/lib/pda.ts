/**
 * Program derived address (PDA) derivations for Settlement Race.
 *
 * Seed layout mirrors the on-chain program:
 *   scenario  = ["scenario",  driver_pubkey,  scenario_id_le_u64]
 *   vault_usd = ["vault_usd", scenario]
 *   vault_cad = ["vault_cad", scenario]
 *   chain_head= ["chain_head", scenario]
 *
 * Seeds are Uint8Array (web3.js accepts Buffer or Uint8Array), so no Buffer
 * global is required and the module works in both Node and the browser.
 */

import { PublicKey } from "@solana/web3.js";

/**
 * Placeholder program id. Must match declare_id! in
 * programs/settlement-race/src/lib.rs (kept in sync by `anchor keys sync`).
 * Devnet only.
 */
export const PROGRAM_ID: PublicKey = new PublicKey(
    "4watv8QyNJ5zjLkh4QYpUKDuFf24SAKzSRLAPMxoWNB3",
);

/** PDA address paired with its bump seed. */
export type Pda = [PublicKey, number];

const U64_MAX = 0xFFFFFFFFFFFFFFFFn;
const textEncoder = new TextEncoder();

/** Little endian 8 byte encoding of a u64 scenario id. */
function u64Le(value: bigint): Uint8Array {
    if (value < 0n || value > U64_MAX) {
        throw new Error(`u64Le: value outside u64 range: ${value.toString()}`);
    }
    const bytes = new Uint8Array(8);
    let rest = value;
    for (let i = 0; i < 8; i++) {
        bytes[i] = Number(rest & 0xffn);
        rest >>= 8n;
    }
    return bytes;
}

/** Scenario account PDA: seeds ["scenario", driver, scenario_id_le_u64]. */
export function scenarioPda(
    driver: PublicKey,
    scenarioId: bigint,
    programId: PublicKey = PROGRAM_ID,
): Pda {
    return PublicKey.findProgramAddressSync(
        [textEncoder.encode("scenario"), driver.toBytes(), u64Le(scenarioId)],
        programId,
    );
}

/** USD escrow vault PDA: seeds ["vault_usd", scenario]. */
export function vaultUsdPda(
    scenario: PublicKey,
    programId: PublicKey = PROGRAM_ID,
): Pda {
    return PublicKey.findProgramAddressSync(
        [textEncoder.encode("vault_usd"), scenario.toBytes()],
        programId,
    );
}

/** CAD escrow vault PDA: seeds ["vault_cad", scenario]. */
export function vaultCadPda(
    scenario: PublicKey,
    programId: PublicKey = PROGRAM_ID,
): Pda {
    return PublicKey.findProgramAddressSync(
        [textEncoder.encode("vault_cad"), scenario.toBytes()],
        programId,
    );
}

/** Chain head PDA: seeds ["chain_head", scenario]. */
export function chainHeadPda(
    scenario: PublicKey,
    programId: PublicKey = PROGRAM_ID,
): Pda {
    return PublicKey.findProgramAddressSync(
        [textEncoder.encode("chain_head"), scenario.toBytes()],
        programId,
    );
}
