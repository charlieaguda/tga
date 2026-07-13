import { auth } from "@/auth";
import type { Role } from "@prisma/client";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

export type SessionUser = {
  id: string;
  role: Role;
  name?: string | null;
  username?: string | null;
  email?: string | null;
  clientId?: string | null;
};

// Minimal resource shapes the policy needs — pass the loaded record.
export type JobResource = { managerId: string };
export type TaskResource = { assigneeId: string | null; job: JobResource };
export type ClientResource = { id: string };
export type CategoryResource = { key: string; clientWritable: boolean };
export type ClientFileResource = { client: ClientResource; category: CategoryResource };

export type Action =
  | "user.manage"
  | "client.write"
  | "client.deactivate"
  | "client.read"
  | "client.file.read"
  | "client.file.upload"
  | "category.write"
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
  | "auditlog.read"
  | "drive.manage"
  | "client.assignDefaults";

const managesJob = (u: SessionUser, job: JobResource) =>
  u.role === "ADMIN" || (u.role === "MANAGER" && job.managerId === u.id);

const managesTask = (u: SessionUser, task: TaskResource) => managesJob(u, task.job);

const isAssignee = (u: SessionUser, task: TaskResource) =>
  u.role === "ADMIN" || (u.role === "EDITOR" && task.assigneeId === u.id);

const isInternalReader = (u: SessionUser) =>
  u.role === "ADMIN" || u.role === "CEO" || u.role === "MANAGER" || u.role === "VIEWER";

const isOwnClient = (u: SessionUser, client: ClientResource) =>
  u.role === "CLIENT" && u.clientId === client.id;

const canReadClient = (u: SessionUser, client: ClientResource) =>
  isInternalReader(u) || isOwnClient(u, client);

// Deny-by-default policy map — the single place the permission matrix lives.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const policy: Record<Action, (u: SessionUser, resource?: any) => boolean> = {
  "user.manage": (u) => u.role === "ADMIN",
  "client.write": (u) => u.role !== "CLIENT",
  "client.deactivate": (u) => u.role === "ADMIN",
  "client.read": (u, client: ClientResource) => canReadClient(u, client),
  "client.file.read": (u, resource: ClientFileResource) => canReadClient(u, resource.client),
  "client.file.upload": (u, resource: ClientFileResource) =>
    u.role === "ADMIN" || u.role === "CEO" || u.role === "MANAGER" ||
    (isOwnClient(u, resource.client) && resource.category.clientWritable),
  "category.write": (u) => u.role !== "CLIENT",
  "job.create": (u) => u.role === "ADMIN" || u.role === "MANAGER",
  "job.write": (u, job: JobResource) => managesJob(u, job),
  "task.create": (u, job: JobResource) => u.role === "CEO" || managesJob(u, job),
  "task.write": (u, task: TaskResource) => u.role === "CEO" || managesTask(u, task),
  "task.assign": (u, task: TaskResource) => u.role === "CEO" || managesTask(u, task),
  "task.read": (u, task: TaskResource) => isInternalReader(u) || isAssignee(u, task),
  "task.cancel": (u, task: TaskResource) => u.role === "CEO" || managesTask(u, task),
  "task.markPosted": (u, task: TaskResource) => managesTask(u, task),
  "submission.create": (u, task: TaskResource) => isAssignee(u, task),
  "review.decide": (u, task: TaskResource) => managesTask(u, task),
  "comment.create": (u, task: TaskResource) => isInternalReader(u) || isAssignee(u, task),
  "dashboard.viewAll": (u) => u.role !== "EDITOR" && u.role !== "CLIENT",
  "auditlog.read": (u) => u.role === "ADMIN" || u.role === "CEO",
  "drive.manage": (u) => u.role === "ADMIN",
  "client.assignDefaults": (u) => u.role === "ADMIN",
};

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.isActive) throw new UnauthorizedError();
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    username: user.username,
    email: user.email,
    clientId: user.clientId,
  };
}

export async function authorize<T>(action: Action, resource?: T): Promise<SessionUser> {
  const user = await requireUser();
  const rule = policy[action];
  if (!rule || !rule(user, resource)) throw new ForbiddenError();
  return user;
}
