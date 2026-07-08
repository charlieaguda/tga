import { Resend } from "resend";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
};

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Send emails AFTER the DB transaction has committed. Failures are logged,
 * never thrown — email is best-effort; the in-app notification is the record.
 */
export async function sendEmails(emails: OutgoingEmail[]) {
  if (emails.length === 0) return;
  if (!resend) {
    // Dev fallback: no provider configured. Log subjects only (no bodies — may quote briefs).
    console.log(`[email] RESEND_API_KEY not set; skipping ${emails.length} email(s):`,
      emails.map((e) => e.subject));
    return;
  }
  const from = process.env.EMAIL_FROM ?? "TGA Workflow <onboarding@resend.dev>";
  await Promise.all(
    emails.map((e) =>
      resend.emails
        .send({ from, to: e.to, subject: e.subject, text: e.text })
        .catch((err) => console.error("[email] send failed:", e.subject, err?.message)),
    ),
  );
}
