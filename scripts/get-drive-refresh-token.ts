/**
 * One-time OAuth consent flow to get a Drive refresh token for local dev,
 * when your org blocks service-account key creation
 * (iam.disableServiceAccountKeyCreation). This authenticates as YOU, a real
 * Google user, instead of a service account — same Shared Drive, same Drive
 * API calls in src/lib/drive.ts, only the credential source differs.
 *
 * Usage:
 *   npx tsx scripts/get-drive-refresh-token.ts <client-id> <client-secret>
 *
 * <client-id>/<client-secret> come from an OAuth client of type "Desktop app"
 * created in Google Cloud Console > APIs & Services > Credentials. That
 * resource type is NOT covered by the SA-key-creation org policy.
 *
 * Opens a browser for consent, catches the redirect on a local loopback
 * server, exchanges the code for tokens, and prints the refresh token to
 * paste into .env as GOOGLE_OAUTH_REFRESH_TOKEN (along with
 * GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).
 */
import { createServer } from "node:http";
import { google } from "googleapis";

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error("Usage: npx tsx scripts/get-drive-refresh-token.ts <client-id> <client-secret>");
  process.exit(2);
}

const PORT = 53682;
const redirectUri = `http://localhost:${PORT}/oauth2callback`;

async function main() {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even if you've consented before
    scope: ["https://www.googleapis.com/auth/drive"],
  });

  const code: string = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(error ? `Error: ${error}. You can close this tab.` : "Success — you can close this tab.");
      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error("No code or error in callback"));
    });
    server.listen(PORT, () => {
      console.log("Open this URL and approve access:\n");
      console.log(authUrl);
      console.log(`\nWaiting for the redirect on ${redirectUri} ...`);
    });
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token returned. If you've authorized this app before, revoke access at " +
        "https://myaccount.google.com/permissions and run this script again.",
    );
    process.exit(1);
  }

  console.log("\nAdd these to .env:\n");
  console.log(`GOOGLE_OAUTH_CLIENT_ID="${clientId}"`);
  console.log(`GOOGLE_OAUTH_CLIENT_SECRET="${clientSecret}"`);
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN="${tokens.refresh_token}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
