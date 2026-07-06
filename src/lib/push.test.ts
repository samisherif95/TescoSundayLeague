import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the layers sendPushToUsers depends on (DB, web-push). env is real and
// reads process.env on every access, so VAPID keys are stubbed per test.
const { db, webpush } = vi.hoisted(() => ({
  db: {
    pushSubscription: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
  webpush: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("web-push", () => ({ default: webpush }));

const PAYLOAD = { title: "New game open ⚽", body: "Sign up", url: "/games/g1" };

const SUBS = [
  { userId: "u1", endpoint: "https://push.example/ep1", p256dh: "k1", auth: "a1" },
  { userId: "u2", endpoint: "https://push.example/ep2", p256dh: "k2", auth: "a2" },
];

// push.ts caches "VAPID configured" in module state, so each test gets a
// fresh module instance to keep env stubs effective.
async function loadSendPush() {
  vi.resetModules();
  return (await import("@/lib/push")).sendPushToUsers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv-key");
  db.pushSubscription.findMany.mockResolvedValue(SUBS);
  db.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
  webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sendPushToUsers", () => {
  it("sends one push per subscribed device", async () => {
    const sendPushToUsers = await loadSendPush();
    await sendPushToUsers(["u1", "u2"], PAYLOAD);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: SUBS[0].endpoint, keys: { p256dh: "k1", auth: "a1" } },
      JSON.stringify(PAYLOAD),
    );
    expect(db.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it("no-ops with a warning when VAPID keys are missing", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sendPushToUsers = await loadSendPush();

    await sendPushToUsers(["u1"], PAYLOAD);

    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("prunes endpoints the push service reports gone (410)", async () => {
    webpush.sendNotification
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockResolvedValueOnce({ statusCode: 201 });
    const sendPushToUsers = await loadSendPush();

    await sendPushToUsers(["u1", "u2"], PAYLOAD);

    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: { in: [SUBS[0].endpoint] } },
    });
  });

  it("retries transient failures (429/5xx) and succeeds", async () => {
    vi.useFakeTimers();
    db.pushSubscription.findMany.mockResolvedValue([SUBS[0]]);
    webpush.sendNotification
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({ statusCode: 201 });
    const sendPushToUsers = await loadSendPush();

    const done = sendPushToUsers(["u1"], PAYLOAD);
    await vi.runAllTimersAsync();
    await done;

    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
    expect(db.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it("logs permanent failures (e.g. 403 VAPID mismatch) without retrying or pruning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    db.pushSubscription.findMany.mockResolvedValue([SUBS[0]]);
    webpush.sendNotification.mockRejectedValue({ statusCode: 403 });
    const sendPushToUsers = await loadSendPush();

    await sendPushToUsers(["u1"], PAYLOAD);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(db.pushSubscription.deleteMany).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("u1"),
      expect.objectContaining({ statusCode: 403 }),
    );
  });
});
