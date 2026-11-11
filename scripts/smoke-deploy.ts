// Smoke test for the devnet deployment of the settlement_race program.
// Asserts the program account exists, is owned by the upgradeable BPF loader
// (or the classic BPF loader), and carries a nonzero data payload.

import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("4watv8QyNJ5zjLkh4QYpUKDuFf24SAKzSRLAPMxoWNB3");
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const CLASSIC_LOADER = "BPFLoader2111111111111111111111111111111111";

async function main(): Promise<void> {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const account = await connection.getAccountInfo(PROGRAM_ID);

    if (account === null) {
        throw new Error(`Program account ${PROGRAM_ID.toBase58()} not found on devnet`);
    }

    const owner = account.owner.toBase58();
    console.log(`Program:    ${PROGRAM_ID.toBase58()}`);
    console.log(`Owner:      ${owner}`);
    console.log(`Data length: ${account.data.length} bytes`);
    console.log(`Executable: ${account.executable}`);

    if (owner !== UPGRADEABLE_LOADER && owner !== CLASSIC_LOADER) {
        throw new Error(`Unexpected owner ${owner}; expected ${UPGRADEABLE_LOADER} or ${CLASSIC_LOADER}`);
    }
    if (account.data.length === 0) {
        throw new Error("Program data length is zero");
    }
    if (!account.executable) {
        throw new Error("Program account is not executable");
    }

    console.log("Smoke test passed: program account is live on devnet with nonzero data.");
}

main().catch((error: unknown) => {
    console.error("Smoke test failed:", error);
    process.exitCode = 1;
});
