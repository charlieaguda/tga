"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { JobStatus, ReviewDecision, Role } from "@prisma/client";
import * as tasks from "@/lib/services/tasks";
import * as jobs from "@/lib/services/jobs";
import * as clients from "@/lib/services/clients";
import * as admin from "@/lib/services/admin";
import * as credentials from "@/lib/services/auth-credentials";
import * as clientFiles from "@/lib/services/client-files";
import { createSessionForUser, destroySession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";

export type ActionResult = { ok: boolean; error?: string };

async function guard(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    if (
      err instanceof ValidationError ||
      err instanceof ConflictError ||
      err instanceof ForbiddenError ||
      err instanceof UnauthorizedError
    ) {
      return { ok: false, error: err.message };
    }
    console.error("[action] unexpected error:", err);
    return { ok: false, error: "Something went wrong" };
  }
}

const id = z.string().min(1).max(64);
const shortText = z.string().trim().min(1).max(300);
const longText = z.string().trim().max(20_000);
const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === "" || /^https:\/\//.test(v), "Must be an https:// URL");
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v ? new Date(v) : undefined))
  .refine((v) => v === undefined || !isNaN(v.getTime()), "Invalid date");

// ---------- Auth (anonymous) ----------

export async function loginWithPassword(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Enter your username and password" };

  const user = await credentials.verifyLogin(parsed.data.username, parsed.data.password);
  if (!user) {
    // Generic message + small delay: no account enumeration, slower brute force.
    await new Promise((r) => setTimeout(r, 300));
    return { ok: false, error: "Invalid username or password" };
  }
  await createSessionForUser(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function changeOwnPassword(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Fill in both fields" };
  const result = await guard(() =>
    credentials.changeOwnPassword(parsed.data.currentPassword, parsed.data.newPassword),
  );
  if (result.ok) redirect("/login"); // all sessions revoked — sign in again
  return result;
}

// ---------- Admin ----------

export async function adminCreateUser(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({
      username: z.string().min(3, "Username must be at least 3 characters").max(32),
      email: z.string().trim().max(200).optional(),
      name: shortText,
      role: z.nativeEnum(Role),
      password: z.string().min(8, "Password must be at least 8 characters").max(200),
      clientId: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { clientId, ...rest } = parsed.data;
  return guard(async () => {
    await admin.createUser({ ...rest, clientId: clientId || undefined });
  });
}

export async function adminSetPassword(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({
      userId: id,
      password: z.string().min(8, "Password must be at least 8 characters").max(200),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() => credentials.adminSetPassword(parsed.data.userId, parsed.data.password));
}

export async function adminSetRole(userId: string, role: Role) {
  return guard(() => admin.setUserRole(id.parse(userId), z.nativeEnum(Role).parse(role)));
}

export async function adminSetActive(userId: string, isActive: boolean) {
  return guard(() => admin.setUserActive(id.parse(userId), isActive));
}

export async function adminReassignJob(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ jobId: id, managerId: id })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() => admin.reassignJobManager(parsed.data.jobId, parsed.data.managerId));
}

// ---------- Clients & Jobs ----------

export async function clientCreate(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ name: shortText, notes: longText.optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(async () => {
    await clients.createClient(parsed.data);
  });
}

export async function clientSetNotionUrl(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ clientId: id, notionUrl: optionalUrl.optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() =>
    clients.setClientNotionUrl(parsed.data.clientId, parsed.data.notionUrl || null),
  );
}

export async function clientOffboard(clientId: string) {
  return guard(() => clients.offboardClient(id.parse(clientId)));
}

export async function jobCreate(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({
      clientId: id,
      title: shortText,
      description: longText.optional(),
      managerId: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { managerId, ...rest } = parsed.data;
  return guard(async () => {
    await jobs.createJob({ ...rest, managerId: managerId || undefined });
  });
}

export async function jobSetStatus(jobId: string, status: JobStatus) {
  return guard(() => jobs.setJobStatus(id.parse(jobId), z.nativeEnum(JobStatus).parse(status)));
}

export async function clientSetActive(clientId: string, isActive: boolean) {
  return guard(() => clients.setClientActive(id.parse(clientId), isActive));
}

export async function jobSetDefaultEditor(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ jobId: id, editorId: z.string().trim().optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() =>
    jobs.setJobDefaultEditor(parsed.data.jobId, parsed.data.editorId || null),
  );
}

// ---------- Tasks ----------

export async function taskCreate(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({
      jobId: id,
      title: shortText,
      brief: longText.optional(),
      referenceLink: optionalUrl.optional(),
      dueAt: optionalDate.optional(),
      assigneeId: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  let taskId: string | null = null;
  const result = await guard(async () => {
    const task = await tasks.createTask({
      ...parsed.data,
      referenceLink: parsed.data.referenceLink || undefined,
      assigneeId: parsed.data.assigneeId || undefined,
    });
    taskId = task.id;
  });
  if (result.ok && taskId) redirect(`/tasks/${taskId}`);
  return result;
}

export async function taskUpdateBrief(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({
      taskId: id,
      title: shortText,
      brief: longText,
      referenceLink: optionalUrl.optional(),
      dueAt: optionalDate.optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { taskId, referenceLink, dueAt, ...rest } = parsed.data;
  return guard(() =>
    tasks.updateTaskBrief(taskId, {
      ...rest,
      referenceLink: referenceLink || null,
      dueAt: dueAt ?? null,
    }),
  );
}

export async function taskAssign(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ taskId: id, assigneeId: id, dueAt: optionalDate.optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() => tasks.assignTask(parsed.data.taskId, parsed.data.assigneeId, parsed.data.dueAt));
}

export async function taskStart(taskId: string) {
  return guard(() => tasks.startTask(id.parse(taskId)));
}

export async function taskStartRevision(taskId: string) {
  return guard(() => tasks.startRevision(id.parse(taskId)));
}

export async function taskSubmit(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ taskId: id, note: longText.optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() => tasks.submitForReview(parsed.data.taskId, parsed.data.note || undefined));
}

export async function taskReview(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ taskId: id, decision: z.nativeEnum(ReviewDecision), comment: longText.optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() =>
    tasks.reviewSubmission(parsed.data.taskId, parsed.data.decision, parsed.data.comment || undefined),
  );
}

export async function taskMarkPosted(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ taskId: id, postUrl: optionalUrl.optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() => tasks.markPosted(parsed.data.taskId, parsed.data.postUrl || undefined));
}

export async function taskCancel(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ taskId: id, reason: shortText })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "A cancellation reason is required" };
  return guard(() => tasks.cancelTask(parsed.data.taskId, parsed.data.reason));
}

export async function commentAdd(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({ taskId: id, body: z.string().trim().min(1, "Comment cannot be empty").max(20_000) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() => tasks.addComment(parsed.data.taskId, parsed.data.body));
}

// ---------- Notifications ----------

export async function notificationsMarkAllRead() {
  return guard(async () => {
    const user = await requireUser();
    await db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  });
}

export async function updateFileDescription(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({
      fileId: id,
      description: z.string().trim().max(1000)
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(async () => {
    await clientFiles.updateClientFileDescription(parsed.data.fileId, parsed.data.description);
  });
}
