import { auth } from "@/auth";
import type { Role } from "@prisma/client";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

export type SessionUser = {
  id: string;
  role: Role;
  name?: string | null;
  username?: string | null;
  email?: string | null;
};

// Minimal resource shapes the policy needs — pass the loaded record.
export type JobResource = { managerId: string };
export type TaskResource = { assigneeId: string | null; job: JobResource };

export type Action =
  | "user.manage"
  | "client.write"
  | "client.deactivate"
  | "job.create"
  | "job.write"
  | "task.create"
  | "task.write"
  | "task.assign"
  | "task.read"
  | "task.cancel"
  | "task.markPosted"
  | "submission.create"
  | "review.decide"
  | "comment.create"
  | "dashboard.viewAll"
  | "auditlog.read";

const managesJob = (u: SessionUser, job: JobResource) =>
  u.role === "ADMIN" || (u.role === "MANAGER" && job.managerId === u.id);

const managesTask = (u: SessionUser, task: TaskResource) => managesJob(u, task.job);

const isAssignee = (u: SessionUser, task: TaskResource) =>
  u.role === "ADMIN" || (u.role === "EDITOR" && task.assigneeId === u.id);

// Deny-by-default policy map — the single place the permission matrix lives.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const policy: Record<Action, (u: SessionUser, resource?: any) => boolean> = {
  "user.manage": (u) => u.role === "ADMIN",
  "client.write": (u) => u.role === "ADMIN" || u.role === "MANAGER",
  "client.deactivate": (u) => u.role === "ADMIN",
  "job.create": (u) => u.role === "ADMIN" || u.role === "MANAGER",
  "job.write": (u, job: JobResource) => managesJob(u, job),
  "task.create": (u, job: JobResource) => u.role === "CEO" || managesJob(u, job),
  "task.write": (u, task: TaskResource) => u.role === "CEO" || managesTask(u, task),
  "task.assign": (u, task: TaskResource) => u.role === "CEO" || managesTask(u, task),
  "task.read": (u, task: TaskResource) =>
    u.role === "ADMIN" || u.role === "CEO" || u.role === "MANAGER" || isAssignee(u, task),
  "task.cancel": (u, task: TaskResource) => u.role === "CEO" || managesTask(u, task),
  "task.markPosted": (u, task: TaskResource) => managesTask(u, task),
  "submission.create": (u, task: TaskResource) => isAssignee(u, task),
  "review.decide": (u, task: TaskResource) => managesTask(u, task),
  "comment.create": (u, task: TaskResource) =>
    u.role === "ADMIN" || u.role === "CEO" || u.role === "MANAGER" || isAssignee(u, task),
  "dashboard.viewAll": (u) => u.role !== "EDITOR",
  "auditlog.read": (u) => u.role === "ADMIN" || u.role === "CEO",
};

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.isActive) throw new UnauthorizedError();
  return { id: user.id, role: user.role, name: user.name, username: user.username, email: user.email };
}

export async function authorize<T>(action: Action, resource?: T): Promise<SessionUser> {
  const user = await requireUser();
  const rule = policy[action];
  if (!rule || !rule(user, resource)) throw new ForbiddenError();
  return user;
}
