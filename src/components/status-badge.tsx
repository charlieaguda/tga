import type { JobStatus, TaskStatus } from "@prisma/client";

const TASK_STYLES: Record<TaskStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  ASSIGNED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  SUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  CHANGES_REQUESTED: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  POSTED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200",
};

const TASK_LABELS: Record<TaskStatus, string> = {
  DRAFT: "Draft",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Awaiting review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  POSTED: "Posted",
  CANCELLED: "Cancelled",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TASK_STYLES[status]}`}
    >
      {TASK_LABELS[status]}
    </span>
  );
}

const JOB_STYLES: Record<JobStatus, string> = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  PAUSED: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  ARCHIVED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${JOB_STYLES[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
