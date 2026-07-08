/**
 * Seed: demo users, clients, jobs, and tasks in every status.
 * Every demo account uses the same fixed password below — fine for local
 * testing since this script refuses to run against production.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient, Role, TaskStatus } from "@prisma/client";

const db = new PrismaClient();

const DEV_PASSWORD = "password123";
const passwordHash = bcrypt.hashSync(DEV_PASSWORD, 12);

async function user(username: string, name: string, role: Role) {
  return db.user.upsert({
    where: { username },
    update: { role, isActive: true, passwordHash },
    create: { username, name, role, passwordHash },
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database");
  }

  const admin = await user("admin", "Alex Admin", "ADMIN");
  const ceo = await user("ceo", "Cameron CEO", "CEO");
  const mgr1 = await user("manager1", "Morgan Manager", "MANAGER");
  const mgr2 = await user("manager2", "Marley Manager", "MANAGER");
  const ed1 = await user("editor1", "Eddie Editor", "EDITOR");
  const ed2 = await user("editor2", "Evan Editor", "EDITOR");

  const acme = await db.client.upsert({
    where: { name: "Acme Fitness" },
    update: {},
    create: { name: "Acme Fitness", notes: "IG: @acmefit — bold colors, fast cuts" },
  });
  const bloom = await db.client.upsert({
    where: { name: "Bloom Cafe" },
    update: {},
    create: { name: "Bloom Cafe", notes: "TikTok + IG. Soft aesthetic." },
  });

  const jobA = await db.job.create({
    data: { clientId: acme.id, managerId: mgr1.id, title: "Instagram management 2026" },
  });
  const jobB = await db.job.create({
    data: { clientId: bloom.id, managerId: mgr2.id, title: "TikTok content H2 2026" },
  });

  const mkTask = (
    jobId: string,
    createdById: string,
    title: string,
    status: TaskStatus,
    assigneeId?: string,
    dueInDays?: number,
  ) =>
    db.task.create({
      data: {
        jobId,
        createdById,
        title,
        brief: `Brief for "${title}": follow the client style guide, 30–45s, add captions.`,
        status,
        assigneeId,
        dueAt: dueInDays !== undefined ? new Date(Date.now() + dueInDays * 86_400_000) : null,
        postedAt: status === "POSTED" ? new Date() : null,
      },
    });

  await mkTask(jobA.id, mgr1.id, "July Reel #1 — gym opening", "DRAFT");
  const t2 = await mkTask(jobA.id, mgr1.id, "July Reel #2 — trainer intro", "ASSIGNED", ed1.id, 3);
  const t3 = await mkTask(jobA.id, mgr1.id, "July Reel #3 — member story", "IN_PROGRESS", ed1.id, -1);
  const t4 = await mkTask(jobB.id, mgr2.id, "Menu teaser video", "SUBMITTED", ed2.id, 2);
  await mkTask(jobB.id, mgr2.id, "Barista behind-the-scenes", "POSTED", ed2.id);

  // Round data so the review flow is exercisable immediately.
  await db.submission.create({ data: { taskId: t3.id, round: 1, submittedById: ed1.id } });
  const sub4 = await db.submission.create({
    data: { taskId: t4.id, round: 1, submittedById: ed2.id, submittedAt: new Date(), note: "First cut" },
  });
  await db.file.create({
    data: {
      submissionId: sub4.id,
      driveFileId: `seed-${sub4.id}`,
      fileName: "menu-teaser.mp4",
      storedName: "bloom-cafe-menu-teaser-v1-menu-teaser.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(24_500_000),
      uploadedById: ed2.id,
    },
  });
  // give the in-progress round a file too so "submit for review" works
  const sub3 = await db.submission.findFirstOrThrow({ where: { taskId: t3.id, round: 1 } });
  await db.file.create({
    data: {
      submissionId: sub3.id,
      driveFileId: `seed-${sub3.id}`,
      fileName: "member-story-draft.mp4",
      storedName: "acme-fitness-member-story-v1-member-story-draft.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(31_000_000),
      uploadedById: ed1.id,
    },
  });
  void t2;

  // Dev sessions (skippable with SEED_SESSIONS=0)
  if (process.env.SEED_SESSIONS !== "0") {
    const users = [admin, ceo, mgr1, mgr2, ed1, ed2];
    console.log("\nDev session tokens (valid 7 days):");
    for (const u of users) {
      const token = randomBytes(32).toString("hex");
      await db.session.create({
        data: {
          sessionToken: token,
          userId: u.id,
          expires: new Date(Date.now() + 7 * 86_400_000),
        },
      });
      console.log(`  ${u.role.padEnd(8)} ${u.username.padEnd(12)} authjs.session-token=${token}`);
    }
  }

  console.log(`\nAll demo accounts use password: ${DEV_PASSWORD}`);
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
