import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { TaskStatusBadge } from "@/components/status-badge";
import { fmtDate, isOverdue } from "@/lib/format";

export type TaskRow = Prisma.TaskGetPayload<{
  include: { job: { include: { client: true } }; assignee: true };
}>;

export function TaskTable({ tasks, empty }: { tasks: TaskRow[]; empty: string }) {
  if (tasks.length === 0)
    return <p className="py-4 text-sm text-gray-500 dark:text-gray-400">{empty}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <th className="py-2 pr-4 font-medium">Task</th>
            <th className="py-2 pr-4 font-medium">Client / Job</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Editor</th>
            <th className="py-2 font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr
              key={t.id}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800"
            >
              <td className="py-2.5 pr-4">
                <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">
                  {t.title}
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">
                {t.job.client.name}
                <span className="text-gray-400"> · {t.job.title}</span>
              </td>
              <td className="py-2.5 pr-4">
                <TaskStatusBadge status={t.status} />
              </td>
              <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">
                {t.assignee?.name ?? "—"}
              </td>
              <td
                className={`py-2.5 ${isOverdue(t) ? "font-semibold text-red-600" : "text-gray-600 dark:text-gray-300"}`}
              >
                {fmtDate(t.dueAt)}
                {isOverdue(t) && " (overdue)"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
