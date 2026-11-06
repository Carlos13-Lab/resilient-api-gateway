import { describe, expect, it } from "vitest";
import { adapters } from "../src/adapters/index.js";
import { eastPolicy, northPolicy, southPolicy } from "./helpers.js";

describe("adapters map heterogeneous payloads to one Policy", () => {
  it("north: snake_case, ISO dates, decimal premium", () => {
    expect(adapters.north.parseOne(northPolicy())).toEqual({
      id: "N-1", provider: "north", holderId: "H-1", status: "active",
      startDate: "2025-01-02", endDate: "2026-01-02", premium: { amount: 120.5, currency: "USD" },
    });
  });

  it("south: numeric status, DD/MM/YYYY dates, premium in cents", () => {
    expect(adapters.south.parseOne(southPolicy())).toEqual({
      id: "S-1", provider: "south", holderId: "H-1", status: "active",
      startDate: "2025-01-02", endDate: "2026-01-02", premium: { amount: 99, currency: "USD" },
    });
  });

  it("east: letter status, epoch seconds, premium as string", () => {
    expect(adapters.east.parseOne(eastPolicy())).toEqual({
      id: "E-1", provider: "east", holderId: "H-1", status: "expired",
      startDate: "2025-01-02", endDate: "2026-01-02", premium: { amount: 75.25, currency: "USD" },
    });
  });

  it("unwraps each upstream's list envelope", () => {
    expect(adapters.north.parseList({ items: [northPolicy()] })).toHaveLength(1);
    expect(adapters.south.parseList({ data: [southPolicy()] })).toHaveLength(1);
    expect(adapters.east.parseList([eastPolicy()])).toHaveLength(1);
  });

  it("rejects payloads that do not match the upstream contract", () => {
    expect(() => adapters.north.parseOne({ policy_number: "x" })).toThrow();
    expect(() => adapters.south.parseOne({ ...southPolicy(), status: 99 })).toThrow();
  });
});
