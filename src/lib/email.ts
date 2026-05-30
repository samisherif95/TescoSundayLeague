import { Resend } from "resend";
import { env } from "./env";

let _resend: Resend | null = null;
function client() {
  if (_resend) return _resend;
  if (!env.resendKey) {
    throw new Error("RESEND_API_KEY is required to send email.");
  }
  _resend = new Resend(env.resendKey);
  return _resend;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  if (!env.resendKey) {
    console.warn("RESEND_API_KEY missing — email not sent", opts.subject);
    return null;
  }
  return client().emails.send({
    from: env.emailFrom,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
