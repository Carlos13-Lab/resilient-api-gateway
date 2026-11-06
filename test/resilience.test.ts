import { describe, expect, it } from "vitest";
import { appWith, json, northPolicy, testConfig, token } from "./helpers.js";
import { createMetrics } from "../src/metrics.js";
import { createUpstream, UpstreamError } from "../src/upstream.js";

const get = (app: Awaited<ReturnType<typeof appWith>>["app"], token: string) =>
  app.inject({ url: "/v1/policies/N-1?provider=north", headers: { authorization: `Bearer ${token}` } });

describe("retry rules", () => {
  it("retries transient 5xx and succeeds", async () => {
    let n = 0;
    const { app, calls } = await appWith({ north: () => (++n < 3 ? json({}, 503) : json(northPolicy())) });
    const res = await get(app, await token());
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("gives up after the configured retries and answers 502 Problem Details", async () => {
    const { app, calls } = await appWith({ north: () => json({}, 500) });
    const res = await get(app, await token());
    expect(res.statusCode).toBe(502);
    expect(calls).toHaveLength(3); // 1 attempt + 2 retries
  });

  it("retries timeouts", async () => {
    let n = 0;
    const slow = () => new Promise<Response>((r) => setTimeout(() => r(json(northPolicy())), 400));
    const { app, calls } = await appWith({ north: () => (++n < 2 ? slow() : json(northPolicy())) }, { timeoutMs: 50 });
    // the fake ignores the abort signal: the gateway must enforce the timeout itself
    expect((await get(app, await token())).statusCode).toBe(200);
    expect(calls.length).toBe(2);
  });

  it("never retries a 4xx", async () => {
    const { app, calls } = await appWith({ north: () => json({ error: "nope" }, 400) });
    const res = await get(app, await token());
    expect(res.statusCode).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it("maps upstream 404 to a gateway 404 without retrying", async () => {
    const { app, calls } = await appWith({ north: () => json({}, 404) });
    expect((await get(app, await token())).statusCode).toBe(404);
    expect(calls).toHaveLength(1);
  });
});

describe("circuit breaker", () => {
  const make = (status: () => number) => {
    const metrics = createMetrics();
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return json({ ok: true }, status());
    }) as typeof fetch;
    const cfg = testConfig({ retries: 0 });
    const up = createUpstream("north", "http://north", cfg, fetchImpl, metrics);
    return { up, metrics, calls: () => calls };
  };

  it("opens after N failures, short-circuits, then half-opens and closes on success", async () => {
    let status = 500;
    const { up, calls } = make(() => status);
    for (let i = 0; i < 3; i++) await expect(up.get("/x", "c")).rejects.toBeInstanceOf(UpstreamError);
    expect(up.state()).toBe("open");

    const before = calls();
    await expect(up.get("/x", "c")).rejects.toMatchObject({ circuitOpen: true });
    expect(calls()).toBe(before); // no call reached the upstream

    await new Promise((r) => setTimeout(r, 80)); // > resetTimeoutMs
    status = 200;
    await up.get("/x", "c"); // half-open probe
    expect(up.state()).toBe("closed");
  });

  it("4xx responses do not trip the breaker", async () => {
    const { up } = make(() => 404);
    for (let i = 0; i < 6; i++) await expect(up.get("/x", "c")).rejects.toBeInstanceOf(UpstreamError);
    expect(up.state()).toBe("closed");
  });

  it("exposes breaker state and retries as Prometheus metrics", async () => {
    const { up, metrics } = make(() => 500);
    for (let i = 0; i < 3; i++) await up.get("/x", "c").catch(() => {});
    const text = await metrics.registry.metrics();
    expect(text).toContain('circuit_breaker_state{upstream="north"} 2');
  });
});
