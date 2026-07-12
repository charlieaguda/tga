import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDriveConnection } from "@/lib/services/drive-connection";
import { driveDisconnect } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_client_not_configured: "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first, then reload this page.",
  invalid_state: "Login attempt expired or was tampered with — try connecting again.",
  no_refresh_token:
    "Google didn't return a refresh token. If this account already granted access before, revoke it at myaccount.google.com/permissions and try again.",
  no_email: "Couldn't read the connected account's email.",
  callback_failed: "Something went wrong connecting to Google Drive.",
  unauthorized: "You don't have permission to manage this.",
};

export default async function DriveSettingsPage(props: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const { error, connected } = await props.searchParams;
  const hasEnvCredential = !!process.env.GOOGLE_SA_KEY_JSON || !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const hasOAuthClient = !!process.env.GOOGLE_OAUTH_CLIENT_ID && !!process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const connection = await getDriveConnection();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Google Drive" />

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </div>
      )}
      {connected && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400">
          Google Drive connected.
        </div>
      )}

      <Section title="Connection">
        {hasEnvCredential && (
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            A service account or OAuth env var is already configured and takes priority over any connection below.
          </p>
        )}
        {connection ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Connected as <span className="font-medium">{connection.googleAccountEmail}</span> — connected by{" "}
              {connection.connectedBy.name} on {fmtDate(connection.createdAt)}.
            </p>
            <ActionButton
              action={driveDisconnect}
              label="Disconnect"
              variant="danger"
              confirm="Disconnect Google Drive? Uploads will stop working until reconnected or a service account is configured."
            />
          </div>
        ) : hasOAuthClient ? (
          <a
            href="/api/admin/drive/connect"
            className="inline-flex items-center rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/10"
          >
            Connect Google Drive
          </a>
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first (GCP Console → Credentials → OAuth
            Client ID), then reload this page.
          </p>
        )}
      </Section>
    </div>
  );
}
