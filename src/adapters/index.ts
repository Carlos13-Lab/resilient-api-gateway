import { z } from "zod";
import type { Provider } from "../config.js";
import { Policy } from "../model.js";

/** One adapter per upstream: how to ask, and how to translate the answer. */
export interface Adapter {
  onePath(id: string): string;
  listPath(holderId: string): string;
  parseOne(raw: unknown): Policy;
  parseList(raw: unknown): Policy[];
}

const q = encodeURIComponent;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dmyToIso = (s: string) => s.split("/").reverse().join("-");

// north: snake_case, ISO dates, decimal premium, string statuses
const North = z.object({
  policy_number: z.string(), holder_id: z.string(),
  state: z.enum(["ACTIVE", "CANCELLED", "EXPIRED"]),
  start_date: z.string(), end_date: z.string(),
  premium_amount: z.number(), currency: z.string(),
});
const fromNorth = (r: z.infer<typeof North>) => Policy.parse({
  id: r.policy_number, provider: "north", holderId: r.holder_id, status: r.state.toLowerCase(),
  startDate: r.start_date, endDate: r.end_date, premium: { amount: r.premium_amount, currency: r.currency },
});

// south: numeric statuses, DD/MM/YYYY dates, money in cents, nested customer
const South = z.object({
  id: z.string(), customer: z.object({ id: z.string() }),
  status: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  effective: z.string(), expiry: z.string(),
  premium: z.object({ amount_cents: z.number(), currency: z.string() }),
});
const southStatus = { 1: "active", 2: "cancelled", 3: "expired" } as const;
const fromSouth = (r: z.infer<typeof South>) => Policy.parse({
  id: r.id, provider: "south", holderId: r.customer.id, status: southStatus[r.status],
  startDate: dmyToIso(r.effective), endDate: dmyToIso(r.expiry),
  premium: { amount: r.premium.amount_cents / 100, currency: r.premium.currency },
});

// east: letter statuses, epoch seconds, money as a string
const East = z.object({
  ref: z.string(), insured: z.string(), status: z.enum(["A", "C", "X"]),
  from: z.number(), to: z.number(), total: z.string(), ccy: z.string(),
});
const eastStatus = { A: "active", C: "cancelled", X: "expired" } as const;
const fromEast = (r: z.infer<typeof East>) => Policy.parse({
  id: r.ref, provider: "east", holderId: r.insured, status: eastStatus[r.status],
  startDate: isoDay(new Date(r.from * 1000)), endDate: isoDay(new Date(r.to * 1000)),
  premium: { amount: Number(r.total), currency: r.ccy },
});

export const adapters: Record<Provider, Adapter> = {
  north: {
    onePath: (id) => `/policies/${q(id)}`,
    listPath: (h) => `/policies?holder_id=${q(h)}`,
    parseOne: (raw) => fromNorth(North.parse(raw)),
    parseList: (raw) => z.object({ items: z.array(North) }).parse(raw).items.map(fromNorth),
  },
  south: {
    onePath: (id) => `/api/v2/policies/${q(id)}`,
    listPath: (h) => `/api/v2/policies?customer=${q(h)}`,
    parseOne: (raw) => fromSouth(South.parse(raw)),
    parseList: (raw) => z.object({ data: z.array(South) }).parse(raw).data.map(fromSouth),
  },
  east: {
    onePath: (id) => `/contracts/${q(id)}`,
    listPath: (h) => `/contracts?insured=${q(h)}`,
    parseOne: (raw) => fromEast(East.parse(raw)),
    parseList: (raw) => z.array(East).parse(raw).map(fromEast),
  },
};
