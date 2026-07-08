/**
 * Browser E2E for username+password auth.
 * Usage: npx tsx scripts/e2e-login.ts <base-url> <username> <password>
 */
import { chromium } from "playwright";

const [base = "http://localhost:3000", username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error("Usage: npx tsx scripts/e2e-login.ts <base-url> <username> <password>");
  process.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: base });
  const page = await ctx.newPage();

  // 1. Unauthenticated → redirected to /login
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  check("unauthenticated redirected to /login", page.url().includes("/login"));

  // 2. Wrong password rejected with generic error, still on /login
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', "definitely-wrong-password");
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(2000);
  const err = await page.getByText("Invalid username or password").count();
  check("wrong password shows generic error", err > 0);
  check("still on /login after failure", page.url().includes("/login"));

  // 3. Correct password → dashboard
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  check("correct password lands on /dashboard", page.url().includes("/dashboard"));

  // 4. Session survives reload
  await page.reload({ waitUntil: "networkidle" });
  check("session persists after reload", page.url().includes("/dashboard"));

  // 5. Sign out → back to /login, dashboard blocked again
  await page.click('button:has-text("Sign out")');
  await page.waitForURL("**/login", { timeout: 15000 });
  check("sign out returns to /login", page.url().includes("/login"));
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  check("dashboard blocked after sign out", page.url().includes("/login"));

  await browser.close();
  console.log(failures === 0 ? "\nLogin E2E: all checks passed." : `\nLogin E2E: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
