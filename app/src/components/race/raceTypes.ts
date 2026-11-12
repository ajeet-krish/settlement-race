/**
 * Shared prop types for the race view components.
 *
 * Kept as a tiny standalone module so every component imports the same
 * unions without reaching into a concrete component file.
 */

/**
 * Whether the engine and demo accounts are wired into the panel. The
 * disconnected state owns the slice before wiring lands; live means an
 * engine source drives events and runs.
 */
export type RaceSource = "disconnected" | "live";

/** Playback speed multipliers offered by the transport bar. */
export type RaceSpeed = 0.5 | 1 | 2;

/** Verification state of the provenance chain, fed by a later slice. */
export type ChainStatus = "VALID" | "BROKEN" | "PENDING";
