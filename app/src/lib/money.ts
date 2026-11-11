/**
 * Integer cents money math for Settlement Race.
 *
 * Every value is a bigint. Floats and doubles never participate in money
 * calculations, per the project convention. Formatting is the only place a
 * human readable decimal string appears, and it is derived from integer math.
 */

/** Currencies traded in this project. */
export type Currency = "USD" | "CAD";

const INTEGER_STRING = /^-?\d+$/;

/**
 * Upper bound on the accepted digit string length, sign included. Twenty
 * characters already exceeds the unsigned 64 bit range, so anything longer is
 * rejected before BigInt() ever runs, keeping parsing cost bounded on
 * untrusted input. Negative sign handling is unchanged.
 */
const MAX_INPUT_LENGTH = 20;

/**
 * Parse a decimal integer string (for example "123456") into cents.
 *
 * Accepts an optional leading minus sign. Rejects decimals, exponents,
 * separators, whitespace, empty strings, mixed content, and digit strings
 * longer than MAX_INPUT_LENGTH characters.
 *
 * @throws Error when the input is not a plain integer string, or when it is
 * longer than MAX_INPUT_LENGTH characters.
 */
export function parse_cents(s: string): bigint {
    if (typeof s !== "string" || !INTEGER_STRING.test(s)) {
        throw new Error(`parse_cents: not an integer string: ${JSON.stringify(s)}`);
    }
    if (s.length > MAX_INPUT_LENGTH) {
        throw new Error(
            `parse_cents: integer string of length ${s.length} exceeds the ${MAX_INPUT_LENGTH} character limit`,
        );
    }
    return BigInt(s);
}

/** Add two cent amounts. bigint addition cannot overflow, so this never fails. */
export function add(a: bigint, b: bigint): bigint {
    return a + b;
}

/**
 * Subtract b from a, returning an Error instead of a negative amount.
 *
 * Returns the non negative difference as a bigint, or an Error describing the
 * would be negative result. Callers must check `instanceof Error`.
 */
export function sub_checked(a: bigint, b: bigint): bigint | Error {
    const difference = a - b;
    if (difference < 0n) {
        return new Error(
            `sub_checked: negative result (${a.toString()} - ${b.toString()})`,
        );
    }
    return difference;
}

/**
 * Format cents as a grouped decimal string with currency code.
 *
 * @example fmt(123456n, "USD") // "1,234.56 USD"
 */
export function fmt(cents: bigint, ccy: Currency): string {
    const negative = cents < 0n;
    const absolute = negative ? -cents : cents;
    const whole = absolute / 100n;
    const frac = absolute % 100n;
    const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const sign = negative ? "-" : "";
    return `${sign}${grouped}.${frac.toString().padStart(2, "0")} ${ccy}`;
}
