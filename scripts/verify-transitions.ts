/**
 * Acceptance checks for the state machine + CAS concurrency guard.
 * Run: npx tsx scripts/verify-transitions.ts   (dev DB must be running)
 */
import { PrismaClient, TaskStatus } from "@prisma/client";
import { canTransition } from "../src/lib/transitions";
import type { SessionUser } from "../src/lib/permissions";

const db = new PrismaClient();
let failures = 0;

function check(name: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

async function main() {
  const mgr1 = { id: "m1", role: "MANAGER" } as SessionUser;
  const mgr2 = { id: "m2", role: "MANAGER" } as SessionUser;
  const ceo = { id: "c1", role: "CEO" } as SessionUser;
  const admin = { id: "a1", role: "ADMIN" } as SessionUser;
  const ed1 = { id: "e1", role: "EDITOR" } as SessionUser;
  const ed2 = { id: "e2", role: "EDITOR" } as SessionUser;

  const task = (status: TaskStatus) => ({
    status,
    assigneeId: "e1",
    job: { managerId: "m1" },
  });

  // Review rights
  check("owning manager approves SUBMITTED", canTransition(mgr1, task("SUBMITTED"), "APPROVED"), true);
  check("other manager cannot approve", canTransition(mgr2, task("SUBMITTED"), "APPROVED"), false);
  check("CEO cannot approve", canTransition(ceo, task("SUBMITTED"), "APPROVED"), false);
  check("editor cannot approve", canTransition(ed1, task("SUBMITTED"), "APPROVED"), false);
  check("admin approves anything", canTransition(admin, task("SUBMITTED"), "APPROVED"), true);

  // Editor flow
  check("assignee starts ASSIGNED task", canTransition(ed1, task("ASSIGNED"), "IN_PROGRESS"), true);
  check("other editor cannot start", canTransition(ed2, task("ASSIGNED"), "IN_PROGRESS"), false);
  check("assignee submits IN_PROGRESS", canTransition(ed1, task("IN_PROGRESS"), "SUBMITTED"), true);
  check("assignee cannot approve own work", canTransition(ed1, task("SUBMITTED"), "APPROVED"), false);
  check("revision loop reopens", canTransition(ed1, task("CHANGES_REQUESTED"), "IN_PROGRESS"), true);

  // Posting + cancel
  check("owning manager marks posted", canTransition(mgr1, task("APPROVED"), "POSTED"), true);
  check("CEO cannot mark posted", canTransition(ceo, task("APPROVED"), "POSTED"), false);
  check("CEO can cancel", canTransition(ceo, task("IN_PROGRESS"), "CANCELLED"), true);
  check("editor cannot cancel", canTransition(ed1, task("IN_PROGRESS"), "CANCELLED"), false);

  // Illegal edges
  check("no skip DRAFT->SUBMITTED", canTransition(admin, task("DRAFT"), "SUBMITTED"), false);
  check("no reopen POSTED", canTransition(admin, task("POSTED"), "IN_PROGRESS"), false);
  check("no cancel POSTED", canTransition(admin, task("POSTED"), "CANCELLED"), false);
  check("no approve before submit", canTransition(mgr1, task("IN_PROGRESS"), "APPROVED"), false);

  // CAS guard against a real row: stale-status update must affect 0 rows.
  const t = await db.task.findFirstOrThrow({ where: { status: "SUBMITTED" } });
  const stale = await db.task.updateMany({
    where: { id: t.id, status: "IN_PROGRESS" }, // wrong expected status
    data: { status: "APPROVED" },
  });
  check("CAS: stale transition writes 0 rows", stale.count === 0, true);
  const fresh = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  check("CAS: task status unchanged", fresh.status === "SUBMITTED", true);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().finally(() => db.$disconnect());
