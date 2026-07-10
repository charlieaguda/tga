import type { JobStatus, TaskStatus } from "@prisma/client";

const TASK_STYLES: Record<TaskStatus, string> = {
  DRAFT: "bg-gray-50/50 text-gray-600 border border-gray-200/60 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-800/80",
  ASSIGNED: "bg-blue-50/50 text-blue-700 border border-blue-200/60 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/50",
  IN_PROGRESS: "bg-indigo-50/50 text-indigo-700 border border-indigo-200/60 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-900/50",
  SUBMITTED: "bg-amber-50/50 text-amber-700 border border-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50",
  CHANGES_REQUESTED: "bg-orange-50/50 text-orange-750 border border-orange-200/60 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-900/50",
  APPROVED: "bg-emerald-50/50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50",
  POSTED: "bg-green-50/50 text-green-700 border border-green-200/60 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900/50",
  CANCELLED: "bg-red-50/50 text-red-700 border border-red-200/60 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/50",
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
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap tracking-wide transition-colors ${TASK_STYLES[status]}`}
    >
      {TASK_LABELS[status]}
    </span>
  );
}

const JOB_STYLES: Record<JobStatus, string> = {
  ACTIVE: "bg-green-50/50 text-green-750 border border-green-200/60 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900/50",
  PAUSED: "bg-amber-50/50 text-amber-700 border border-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50",
  ARCHIVED: "bg-gray-50/50 text-gray-500 border border-gray-200/60 dark:bg-gray-900/40 dark:text-gray-400 dark:border-gray-800/80",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors ${JOB_STYLES[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

