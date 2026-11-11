import { describe, expect, it } from "vitest";
import { add, fmt, parse_cents, sub_checked } from "../money";

describe("parse_cents", () => {
    it("parses plain integer strings", () => {
        expect(parse_cents("0")).toBe(0n);
        expect(parse_cents("1")).toBe(1n);
        expect(parse_cents("123456")).toBe(123456n);
        expect(parse_cents("-42")).toBe(-42n);
        expect(parse_cents("1000000")).toBe(1000000n);
    });

    it("rejects anything that is not an integer string", () => {
        const bad = [
            "",
            " ",
            "1.0",
            "1.5",
            "1e3",
            "0x10",
            "1,234",
            "12abc",
            "+12",
            " 12",
            "12 ",
            "NaN",
            "Infinity",
            "\u0661\u0662\u0663",
        ];
        for (const s of bad) {
            expect(
                () => parse_cents(s),
                `should reject ${JSON.stringify(s)}`,
            ).toThrow();
        }
    });

    it("bounds the digit string length before BigInt parsing", () => {
        // 20 characters is the limit and stays accepted.
        expect(parse_cents("11111111111111111111")).toBe(11111111111111111111n);
        expect(parse_cents("-1111111111111111111")).toBe(-1111111111111111111n);
        // 21 characters is rejected, sign included.
        expect(() => parse_cents("9".repeat(21))).toThrow(/20 character limit/);
        expect(() => parse_cents(`-${"9".repeat(20)}`)).toThrow(
            /20 character limit/,
        );
        expect(() => parse_cents("0".repeat(1000))).toThrow(
            /20 character limit/,
        );
    });
});

describe("add", () => {
    it("sums cent amounts", () => {
        expect(add(1_000_000n, 350_000n)).toBe(1_350_000n);
        expect(add(-50n, 50n)).toBe(0n);
    });

    it("never overflows", () => {
        expect(add(2n ** 63n, 1n)).toBe(2n ** 63n + 1n);
    });
});

describe("sub_checked", () => {
    it("returns the difference when it is non negative", () => {
        expect(sub_checked(1_000n, 400n)).toBe(600n);
        expect(sub_checked(400n, 400n)).toBe(0n);
    });

    it("returns an Error instead of a negative amount", () => {
        const result = sub_checked(400n, 1_000n);
        expect(result).toBeInstanceOf(Error);
        const message = (result as Error).message;
        expect(message).toContain("negative");
        expect(message).toContain("400");
        expect(message).toContain("1000");
    });
});

describe("fmt", () => {
    it("groups thousands and always shows two decimals", () => {
        expect(fmt(123_456n, "USD")).toBe("1,234.56 USD");
        expect(fmt(123_456_789n, "CAD")).toBe("1,234,567.89 CAD");
        expect(fmt(0n, "USD")).toBe("0.00 USD");
        expect(fmt(5n, "CAD")).toBe("0.05 CAD");
        expect(fmt(99n, "USD")).toBe("0.99 USD");
        expect(fmt(100_000_000n, "USD")).toBe("1,000,000.00 USD");
    });

    it("formats negative amounts with a leading sign", () => {
        expect(fmt(-2_500n, "CAD")).toBe("-25.00 CAD");
        expect(fmt(-1n, "USD")).toBe("-0.01 USD");
    });

    it("formats one cent, exact dollars, and u64 sized values without floats", () => {
        expect(fmt(1n, "USD")).toBe("0.01 USD");
        expect(fmt(100n, "USD")).toBe("1.00 USD");
        expect(fmt(1_000n, "CAD")).toBe("10.00 CAD");
        expect(fmt(-1_234_567n, "USD")).toBe("-12,345.67 USD");
        // u64 max: derived purely from integer division, no float rounding.
        expect(fmt(18_446_744_073_709_551_615n, "USD")).toBe(
            "184,467,440,737,095,516.15 USD",
        );
    });
});
