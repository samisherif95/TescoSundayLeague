import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let _transport: Transporter | null = null;
function transport(): Transporter | null {
  if (_transport) return _transport;
  const cfg = env.smtp;
  if (!cfg) return null;
  _transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Omit auth entirely for relays that don't require it (e.g. a local
    // dev MailHog). Most providers (Gmail, SES, Mailgun) will set both.
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    // Bulk notifications (new game, lock, cancel, complete) fan out one
    // sendEmail() per member *concurrently*. Without pooling, nodemailer
    // opens a fresh connection for every message, so a group blast briefly
    // holds N simultaneous connections — and every provider caps concurrent
    // connections per account (Gmail especially). The surplus gets rejected
    // ("421 Too many concurrent connections") and those members silently miss
    // out. Pooling reuses a small, bounded set of connections and queues the
    // rest, and the rate limit keeps us under per-second send caps too.
    pool: true,
    maxConnections: 3,
    maxMessages: Infinity,
    rateDelta: 1000,
    rateLimit: 10,
  });
  return _transport;
}

// A send failure is "transient" — worth retrying — when it's a temporary
// server condition (SMTP 4xx, e.g. 421 greylisting / rate-limit / too many
// connections) or a connection-level blip (timeout, dropped socket). A 5xx is
// permanent (bad address, blocked) and a retry would only spam, so we don't.
function isTransient(err: unknown): boolean {
  const e = err as { responseCode?: number; code?: string };
  if (typeof e?.responseCode === "number") {
    return e.responseCode >= 400 && e.responseCode < 500;
  }
  // No SMTP response at all → a connection problem; these are retryable.
  return ["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNRESET"].includes(
    e?.code ?? "",
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  const t = transport();
  if (!t) {
    console.warn("SMTP not configured — email not sent:", opts.subject);
    return null;
  }
  // Retry transient failures with backoff so a single member isn't permanently
  // dropped from a notification by a momentary SMTP hiccup. Pooling already
  // bounds concurrency; this covers the residual flakiness.
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await t.sendMail({
        from: env.emailFrom,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
    } catch (err) {
      if (attempt < maxAttempts && isTransient(err)) {
        await sleep(2 ** (attempt - 1) * 500); // 500ms, then 1s
        continue;
      }
      // Out of retries (or a permanent failure). Bulk senders wrap each call in
      // Promise.allSettled, so this rejection is otherwise swallowed with no
      // trace — leaving "some people didn't get the email" impossible to
      // diagnose. Log who/what failed, then rethrow so direct awaiters
      // (password reset, verification) still surface the error.
      console.error(
        `Failed to send email "${opts.subject}" to ${String(opts.to)} after ${attempt} attempt(s):`,
        err,
      );
      throw err;
    }
  }
}
