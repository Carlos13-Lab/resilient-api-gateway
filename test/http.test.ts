import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { appWith, fakeUpstreams, testConfig, eastPolicy, json, northPolicy, southPolicy, token } from "./helpers.js";

const auth = async (scope?: string) => ({ authorization: `Bearer ${await token(scope)}` });
const ok = { north: () => json(northPolicy()), south: () => json(southPolicy()), east: () => json(eastPolicy()) };

describe("auth", () => {
  it("401 problem+json without a token", async () => {
    const { app } = await appWith(ok);
    const res = await app.inject({ url: "/v1/policies/N-1?provider=north" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.headers["www-authenticate"]).toContain("Bearer");
  });

  it("401 for a token signed with the wrong secret", async () => {
    const { app } = await appWith(ok);
    const bad = await token("policies:read", "another-secret-another-secret-123456");
    const res = await app.inject({ url: "/v1/policies/N-1?provider=north", headers: { authorization: `Bearer ${bad}` } });
    expect(res.statusCode).toBe(401);
  });

  it("403 when the scope is missing", async () => {
    const { app } = await appWith(ok);
    const res = await app.inject({ url: "/v1/policies/N-1?provider=north", headers: await auth("other:scope") });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ status: 403, title: "Forbidden" });
  });

  it("200 with the right scope", async () => {
    const { app } = await appWith(ok);
    const res = await app.inject({ url: "/v1/policies/N-1?provider=north", headers: await auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "N-1", provider: "north" });
  });
});

describe("Problem Details", () => {
  it("has the RFC 7807 shape and echoes the correlation id", async () => {
    const { app } = await appWith(ok);
    const res = await app.inject({ url: "/v1/policies/N-1?provider=mars", headers: { ...(await auth()), "x-correlation-id": "abc-123" } });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toEqual({
      type: "about:blank", title: "Bad Request", status: 400,
      detail: expect.any(String), instance: "/v1/policies/N-1?provider=mars", correlationId: "abc-123",
    });
  });

  it("unknown routes are problem+json too", async () => {
    const { app } = await appWith(ok);
    const res = await app.inject({ url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("correlation id", () => {
  it("propagates an incoming id to the upstream and the response", async () => {
    const { app, calls } = await appWith(ok);
    const res = await app.inject({ url: "/v1/policies/N-1?provider=north", headers: { ...(await auth()), "x-correlation-id": "trace-me" } });
    expect(res.headers["x-correlation-id"]).toBe("trace-me");
    expect(calls[0]?.headers.get("x-correlation-id")).toBe("trace-me");
  });

  it("is stamped on every log line of the request", async () => {
    const lines: string[] = [];
    const net = fakeUpstreams(ok);
    const app = buildApp(testConfig(), net.fetchImpl, { logger: { level: "info", stream: { write: (l: string) => void lines.push(l) } } });
    await app.inject({ url: "/v1/policies/N-1?provider=north", headers: { ...(await auth()), "x-correlation-id": "log-me" } });
    const logs = lines.map((l) => JSON.parse(l)).filter((l) => l.req || l.res);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.correlationId === "log-me")).toBe(true);
  });

  it("generates one when absent", async () => {
    const { app, calls } = await appWith(ok);
    const res = await app.inject({ url: "/v1/policies/N-1?provider=north", headers: await auth() });
    const id = res.headers["x-correlation-id"];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]?.headers.get("x-correlation-id")).toBe(id);
  });
});

describe("fan-out", () => {
  const list = (headers: Record<string, string>) => ({ url: "/v1/policies?holderId=H-1", headers });

  it("merges every provider", async () => {
    const { app } = await appWith({
      north: () => json({ items: [northPolicy()] }),
      south: () => json({ data: [southPolicy()] }),
      east: () => json([eastPolicy()]),
    });
    const res = await app.inject(list(await auth()));
    expect(res.statusCode).toBe(200);
    expect(res.json().policies.map((p: { provider: string }) => p.provider).sort()).toEqual(["east", "north", "south"]);
    expect(res.json().warnings).toEqual([]);
  });

  it("returns partial results with warnings when one provider fails", async () => {
    const { app } = await appWith({
      north: () => json({ items: [northPolicy()] }),
      south: () => json({}, 500),
      east: () => json([eastPolicy()]),
    });
    const res = await app.inject(list(await auth()));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.policies).toHaveLength(2);
    expect(body.warnings).toEqual([{ provider: "south", detail: expect.any(String) }]);
  });

  it("502 when every provider fails", async () => {
    const { app } = await appWith({ north: () => json({}, 500), south: () => json({}, 500), east: () => json({}, 500) });
    expect((await app.inject(list(await auth()))).statusCode).toBe(502);
  });

  it("requires holderId", async () => {
    const { app } = await appWith(ok);
    expect((await app.inject({ url: "/v1/policies", headers: await auth() })).statusCode).toBe(400);
  });
});

describe("/metrics", () => {
  it("records request duration by route and status", async () => {
    const { app } = await appWith(ok);
    await app.inject({ url: "/v1/policies/N-1?provider=north", headers: await auth() });
    const res = await app.inject({ url: "/metrics" });
    expect(res.body).toContain('http_request_duration_seconds_count{route="/v1/policies/:id",method="GET",status_code="200"} 1');
  });
});
