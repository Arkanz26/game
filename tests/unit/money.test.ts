import { describe, expect, it } from "vitest";
import { formatRupiah, parseMoneyInput, sum, toMoneyString } from "@/lib/money";

describe("money", () => {
  it("parses id-ID and plain formats exactly", () => {
    expect(parseMoneyInput("1.250.000,50")).toBe("1250000.50");
    expect(parseMoneyInput("Rp 1.250.000")).toBe("1250000.00");
    expect(parseMoneyInput("1250000.5")).toBe("1250000.50");
    expect(parseMoneyInput("200.000.000.000")).toBe("200000000000.00");
    expect(parseMoneyInput("12,3,4")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
  });

  it("never loses precision on large Rupiah sums (no floats)", () => {
    // 0.1 + 0.2 style error and >2^53 values
    expect(sum(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
    expect(sum(["9007199254740993.01", "1.02"]).toFixed(2)).toBe("9007199254740994.03");
    expect(toMoneyString("1.005")).toBe("1.01");
  });

  it("formats Rupiah with negatives in parentheses", () => {
    expect(formatRupiah("1250000.5")).toBe("Rp1.250.000,50");
    expect(formatRupiah("-500")).toBe("(Rp500,00)");
    expect(formatRupiah("-500", { parens: false })).toBe("-Rp500,00");
  });
});
