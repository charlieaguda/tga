/**
 * Browser E2E over the review workflow (server actions + UI wiring).
 * Prereqs: seeded DB (npm run db:seed printed session tokens), app running.
 * Usage: npx tsx scripts/e2e.ts <base-url> <managerToken> <editorToken>
 * Tokens: manager2 + editor2 (the "Menu teaser video" task, seeded SUBMITTED).
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";

const [base = "http://localhost:3001", managerToken, editorToken] = process.argv.slice(2);
if (!managerToken || !editorToken) {
  console.error("Usage: npx tsx scripts/e2e.ts <base-url> <managerToken> <editorToken>");
  process.exit(2);
}

const db = new PrismaClient();
let failures = 0;
function check(name: string, ok: boolean) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

async function ctxFor(browser: Awaited<ReturnType<typeof chromium.launch>>, token: string) {
  const ctx = await browser.newContext({ baseURL: base });
  const url = new URL(base);
  await ctx.addCookies([
    {
      name: "authjs.session-token",
      value: token,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return ctx;
}

async function main() {
  const task = await db.task.findFirstOrThrow({
    where: { title: "Menu teaser video", status: "SUBMITTED" },
    orderBy: { createdAt: "desc" },
    include: { assignee: true },
  });
  check("seeded task starts SUBMITTED", task.status === "SUBMITTED");

  const browser = await chromium.launch();
  const manager = await ctxFor(browser, managerToken);
  const editor = await ctxFor(browser, editorToken);

  // 1. Manager requests changes (comment required).
  let page = await manager.newPage();
  await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });
  await page.fill('textarea[name="comment"]', "Tighten the intro, add captions in brand font.");
  await page.click('button:has-text("Request changes")');
  await page.waitForTimeout(1500);
  await page.close();
  let dbTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  check("request changes -> CHANGES_REQUESTED", dbTask.status === "CHANGES_REQUESTED");

  // 2. Editor starts revision (opens round 2).
  page = await editor.newPage();
  await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });
  await page.click('button:has-text("Start revision")');
  await page.waitForTimeout(1500);
  await page.close();
  dbTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  const round2 = await db.submission.findUnique({
    where: { taskId_round: { taskId: task.id, round: 2 } },
  });
  check("start revision -> IN_PROGRESS", dbTask.status === "IN_PROGRESS");
  check("round 2 opened", !!round2 && round2.submittedAt === null);

  // 3. Submit with no files must be rejected (guard).
  page = await editor.newPage();
  await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });
  await page.click('button:has-text("Submit for review")');
  await page.waitForTimeout(1500);
  const guardError = await page.getByText("Upload at least one deliverable").count();
  check("submit without files rejected with message", guardError > 0);
  dbTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  check("status unchanged after rejected submit", dbTask.status === "IN_PROGRESS");

  // Simulate a completed upload (Drive isn't configured in dev).
  await db.file.create({
    data: {
      submissionId: round2!.id,
      driveFileId: `seed-e2e-${round2!.id}`,
      fileName: "menu-teaser-v2.mp4",
      storedName: "bloom-cafe-menu-teaser-v2-menu-teaser-v2.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(20_000_000),
      uploadedById: task.assignee!.id,
    },
  });

  // 4. Submit for review with note.
  await page.reload({ waitUntil: "networkidle" });
  await page.fill('textarea[name="note"]', "Tightened intro; captions added.");
  await page.click('button:has-text("Submit for review")');
  await page.waitForTimeout(1500);
  await page.close();
  dbTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  check("resubmit -> SUBMITTED (round 2)", dbTask.status === "SUBMITTED");

  // 5. Manager approves.
  page = await manager.newPage();
  await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });
  await page.click('button:has-text("Approve")');
  await page.waitForTimeout(1500);
  await page.close();
  dbTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  check("approve -> APPROVED", dbTask.status === "APPROVED");

  // 6. Manager marks posted with URL.
  page = await manager.newPage();
  await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });
  await page.fill('input[name="postUrl"]', "https://instagram.com/p/e2e-test");
  await page.click('button:has-text("Mark as posted")');
  await page.waitForTimeout(1500);
  await page.close();
  dbTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  check("mark posted -> POSTED with postedAt", dbTask.status === "POSTED" && !!dbTask.postedAt);
  check("post URL stored", dbTask.postUrl === "https://instagram.com/p/e2e-test");

  // 7. Notifications reached the editor (changes requested + approved + posted).
  const notes = await db.notification.findMany({
    where: { userId: task.assignee!.id, taskId: task.id },
    orderBy: { createdAt: "asc" },
  });
  const types = notes.map((n) => n.type);
  check("editor notified: CHANGES_REQUESTED", types.includes("CHANGES_REQUESTED"));
  check("editor notified: TASK_APPROVED", types.includes("TASK_APPROVED"));
  check("editor notified: TASK_POSTED", types.includes("TASK_POSTED"));

  // 8. Full audit trail exists.
  const log = await db.activityLog.findMany({ where: { taskId: task.id } });
  const actions = log.map((l) => l.action);
  check(
    "activity log covers the whole flow",
    ["review.changes_requested", "submission.round_opened", "review.approved", "task.status_changed"].every(
      (a) => actions.includes(a),
    ),
  );

  await browser.close();
  console.log(failures === 0 ? "\nE2E: all checks passed." : `\nE2E: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
