import { PROVIDERS, type Provider } from "./config.js";
import { adapters } from "./adapters/index.js";
import { HttpError } from "./errors.js";
import type { Policy } from "./model.js";
import { UpstreamError, type Upstream } from "./upstream.js";
import { ZodError } from "zod";

export type Upstreams = Record<Provider, Upstream>;
export interface Warning { provider: Provider; detail: string }

/** Turns any upstream-side failure into a gateway HttpError. */
function toHttpError(provider: Provider, err: unknown): HttpError {
  if (err instanceof UpstreamError) {
    if (err.upstreamStatus === 404) return new HttpError(404, "Policy not found");
    if (err.circuitOpen) return new HttpError(503, `${provider} is temporarily unavailable`, { "retry-after": "10" });
    return new HttpError(502, `${provider} upstream failed: ${err.message}`);
  }
  if (err instanceof ZodError) return new HttpError(502, `${provider} returned an unexpected payload`);
  return new HttpError(500, "Internal server error");
}

export async function getPolicy(up: Upstreams, provider: Provider, id: string, cid: string): Promise<Policy> {
  const a = adapters[provider];
  try {
    return a.parseOne(await up[provider].get(a.onePath(id), cid));
  } catch (err) {
    throw toHttpError(provider, err);
  }
}

/** Fan out to every provider; one failing provider degrades the answer instead of failing it. */
export async function listPolicies(up: Upstreams, holderId: string, cid: string) {
  const results = await Promise.allSettled(
    PROVIDERS.map(async (p) => adapters[p].parseList(await up[p].get(adapters[p].listPath(holderId), cid))),
  );
  const policies: Policy[] = [];
  const warnings: Warning[] = [];
  results.forEach((r, i) => {
    const provider = PROVIDERS[i]!;
    if (r.status === "fulfilled") policies.push(...r.value);
    else warnings.push({ provider, detail: toHttpError(provider, r.reason).message });
  });
  if (warnings.length === PROVIDERS.length) throw new HttpError(502, "All providers failed");
  return { policies, warnings };
}
