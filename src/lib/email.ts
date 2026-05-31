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
  });
  return _transport;
}

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
  return t.sendMail({
    from: env.emailFrom,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
