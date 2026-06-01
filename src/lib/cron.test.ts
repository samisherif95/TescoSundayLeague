import { describe, it, expect, vi, beforeEach } from "vitest";

// Control what the (async) Next headers() returns per test.
let authHeader: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "authorization" ? authHeader : null,
  }),
}));

import { assertCronAuth } from "@/lib/cron";

const SECRET = "s3cr3t-cron-token";

beforeEach(() => {
  authHeader = null;
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("NODE_ENV", "production");
});

function req(path = "https://app.example.com/api/cron/x") {
  return new Request(path);
}

/** Resolve to the thrown value (a Response) instead of rejecting the assertion. */
async function thrown(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e) => e,
  );
}

describe("assertCronAuth", () => {
  it("passes when the Bearer token matches CRON_SECRET", async () => {
    authHeader = `Bearer ${SECRET}`;
    await expect(assertCronAuth(req())).resolves.toBeUndefined();
  });

  it("rejects with a 401 Response when the header is missing", async () => {
    authHeader = null;
    const err = await thrown(assertCronAuth(req()));
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(401);
  });

  it("rejects with a 401 when the token is wrong", async () => {
    authHeader = "Bearer not-the-secret";
    const err = await thrown(assertCronAuth(req()));
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(401);
  });

  it("rejects a bare token without the Bearer prefix", async () => {
    authHeader = SECRET;
    const err = await thrown(assertCronAuth(req()));
    expect((err as Response).status).toBe(401);
  });

  it("allows the ?dev=1 bypass only outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    authHeader = null;
    await expect(
      assertCronAuth(req("https://localhost/api/cron/x?dev=1")),
    ).resolves.toBeUndefined();
  });

  it("ignores the ?dev=1 bypass in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    authHeader = null;
    const err = await thrown(
      assertCronAuth(req("https://app.example.com/api/cron/x?dev=1")),
    );
    expect((err as Response).status).toBe(401);
  });
});
