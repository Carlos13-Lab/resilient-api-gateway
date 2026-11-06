// Tiny mock upstream. PROVIDER=north|south|east, FAILURE_RATE=0..1 (random 503s), LATENCY_MS.
import { createServer } from "node:http";

const provider = process.env.PROVIDER ?? "north";
const failureRate = Number(process.env.FAILURE_RATE ?? 0);
const latency = Number(process.env.LATENCY_MS ?? 20);
const port = Number(process.env.PORT ?? 4000);

// Same three policies in each upstream's own dialect.
const base = [
  { id: "P-1001", holder: "H-1", status: 0, from: "2025-01-02", to: "2026-01-02", cents: 12050 },
  { id: "P-1002", holder: "H-1", status: 1, from: "2024-03-10", to: "2025-03-10", cents: 8900 },
  { id: "P-2001", holder: "H-2", status: 2, from: "2025-06-01", to: "2026-06-01", cents: 30000 },
];
const dmy = (iso) => iso.split("-").reverse().join("/");
const epoch = (iso) => Date.parse(iso) / 1000;

const dialects = {
  north: {
    one: /^\/policies\/([^/]+)$/, list: /^\/policies$/, holderParam: "holder_id",
    map: (p) => ({ policy_number: p.id, holder_id: p.holder, state: ["ACTIVE", "CANCELLED", "EXPIRED"][p.status], start_date: p.from, end_date: p.to, premium_amount: p.cents / 100, currency: "USD" }),
    wrap: (rows) => ({ items: rows }),
  },
  south: {
    one: /^\/api\/v2\/policies\/([^/]+)$/, list: /^\/api\/v2\/policies$/, holderParam: "customer",
    map: (p) => ({ id: p.id, customer: { id: p.holder }, status: p.status + 1, effective: dmy(p.from), expiry: dmy(p.to), premium: { amount_cents: p.cents, currency: "USD" } }),
    wrap: (rows) => ({ data: rows }),
  },
  east: {
    one: /^\/contracts\/([^/]+)$/, list: /^\/contracts$/, holderParam: "insured",
    map: (p) => ({ ref: p.id, insured: p.holder, status: ["A", "C", "X"][p.status], from: epoch(p.from), to: epoch(p.to), total: (p.cents / 100).toFixed(2), ccy: "USD" }),
    wrap: (rows) => rows,
  },
};
const d = dialects[provider];

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  console.log(JSON.stringify({ provider, path: url.pathname, correlationId: req.headers["x-correlation-id"] }));
  setTimeout(() => {
    if (Math.random() < failureRate) return send(res, 503, { error: "flaky upstream" });
    const one = d.one.exec(url.pathname);
    if (one) {
      const p = base.find((x) => x.id === decodeURIComponent(one[1]));
      return p ? send(res, 200, d.map(p)) : send(res, 404, { error: "not found" });
    }
    if (d.list.test(url.pathname)) {
      const holder = url.searchParams.get(d.holderParam);
      return send(res, 200, d.wrap(base.filter((x) => x.holder === holder).map(d.map)));
    }
    send(res, 404, { error: "not found" });
  }, latency);
}).listen(port, () => console.log(`${provider} mock on :${port}, failure rate ${failureRate}`));
