"use client";

import { useState } from "react";
import Link from "next/link";
import type { TaskStatus } from "@prisma/client";
import { AddCategoryButton } from "@/components/add-category-button";
import { CategoryFilesButton } from "@/components/category-files-button";
import { MonthCalendar } from "@/components/month-calendar";
import { TaskStatusBadge } from "@/components/status-badge";
import { isOverdue, fmtDate } from "@/lib/format";
import { buildTaskDaysMap } from "@/lib/task-calendar";
import type { FileActivityDaysMap } from "@/lib/file-activity-calendar";

interface CategoryDef {
  key: string;
  label: string;
  clientWritable: boolean;
}

interface ClientFile {
  id: string;
  driveFileId: string;
  storedName: string;
  sizeBytes: bigint | number;
  category: string | null;
  description: string | null;
  mimeType: string;
}

interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: Date;
  dueAt: Date | null;
  assignee?: { name: string } | null;
}

interface JobWithTasks {
  id: string;
  title: string;
  tasks: TaskSummary[];
}

interface ClientWithFilesAndActivity {
  id: string;
  name: string;
  notes: string | null;
  notionUrl: string | null;
  files: ClientFile[];
  activeDays: string[];
  fileActivityDays: FileActivityDaysMap;
  jobs: JobWithTasks[];
}

export function ClientHubAccordion({
  clients,
  year,
  month,
  canEdit,
  canMarkUsed = false,
  categories,
  driveConfigured,
}: {
  clients: ClientWithFilesAndActivity[];
  year: number;
  month: number;
  canEdit: boolean;
  canMarkUsed?: boolean;
  categories: CategoryDef[];
  driveConfigured: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {clients.map((c) => (
        <ClientCard
          key={c.id}
          client={c}
          year={year}
          month={month}
          canEdit={canEdit}
          canMarkUsed={canMarkUsed}
          categories={categories}
          driveConfigured={driveConfigured}
        />
      ))}
      {clients.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
          No assigned clients found.
        </div>
      )}
    </div>
  );
}

function ClientCard({
  client,
  year,
  month,
  canEdit,
  canMarkUsed,
  categories,
  driveConfigured,
}: {
  client: ClientWithFilesAndActivity;
  year: number;
  month: number;
  canEdit: boolean;
  canMarkUsed: boolean;
  categories: CategoryDef[];
  driveConfigured: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const fileCount = client.files.length;
  const noteExcerpt = client.notes
    ? client.notes.length > 80
      ? client.notes.slice(0, 80) + "..."
      : client.notes
    : "";
  const taskDays = buildTaskDaysMap(client.jobs.flatMap((j) => j.tasks));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_-3px_rgba(0,0,0,0.02)] dark:border-slate-800/80 dark:bg-slate-900 transition-all duration-200">
      {/* Clickable Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
      >
        <div className="min-w-0 flex-1 pr-4">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">{client.name}</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
            {noteExcerpt ? `${noteExcerpt} · ` : ""}
            <span className="font-semibold text-slate-600 dark:text-slate-300">
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </span>{" "}
            in client hub
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">
            {isExpanded ? "Collapse" : "Open Hub Details"}
          </span>
          <svg
            className={`h-5 w-5 text-slate-400 transition-transform duration-300 dark:text-slate-500 ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded card contents */}
      {isExpanded && (
        <div className="border-t border-slate-100 p-5 dark:border-slate-800/80 bg-slate-50/20 dark:bg-slate-900/10 flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            
            {/* Notes Column */}
            <div className="flex flex-col gap-5">
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                  Notes & guidelines
                </h4>
                {client.notes ? (
                  <div className="rounded-xl border border-slate-200/60 bg-white p-4 text-sm text-slate-700 whitespace-pre-wrap dark:border-slate-800/60 dark:bg-slate-950/40 dark:text-slate-300 shadow-sm leading-relaxed">
                    {client.notes}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-500 italic">No notes provided.</p>
                )}
              </div>

              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                  Jobs & tasks
                </h4>
                {client.jobs.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500 italic">No jobs yet.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {client.jobs.map((job) => (
                      <div
                        key={job.id}
                        className="rounded-xl border border-slate-200/60 bg-white p-3 dark:border-slate-800/60 dark:bg-slate-950/40"
                      >
                        <Link
                          href={`/jobs/${job.id}`}
                          className="mb-1.5 block truncate text-xs font-semibold text-slate-700 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400"
                        >
                          {job.title}
                        </Link>
                        {job.tasks.length === 0 ? (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">No tasks yet.</p>
                        ) : (
                          <ul className="flex flex-col gap-1.5">
                            {job.tasks.map((t) => (
                              <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                                <Link
                                  href={`/tasks/${t.id}`}
                                  className="truncate text-slate-600 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
                                >
                                  {t.title}
                                </Link>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {t.assignee && (
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                      {t.assignee.name}
                                    </span>
                                  )}
                                  {isOverdue(t) && (
                                    <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">
                                      due {fmtDate(t.dueAt)}
                                    </span>
                                  )}
                                  <TaskStatusBadge status={t.status} />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {client.notionUrl && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Linked Notion Workspace
                  </h4>
                  <iframe
                    src={client.notionUrl}
                    className="h-[35vh] w-full rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-950 shadow-sm"
                  />
                  <a
                    href={client.notionUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-semibold"
                  >
                    Open page in Notion new tab
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
            </div>

            {/* Collapsible File Categories Grid (2 Columns inside parent grid column) */}
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                Client Hub files (By Category)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {categories.map((category) => (
                  <CategoryFilesButton
                    key={category.key}
                    clientId={client.id}
                    category={category}
                    files={client.files.filter((f) => f.category === category.key)}
                    canEdit={canEdit}
                    canModify={true}
                    categories={categories}
                    driveConfigured={driveConfigured}
                  />
                ))}
              </div>

              {fileCount === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">No files have been uploaded yet.</p>
              )}

              <div className="mt-3 flex justify-center rounded-xl border border-dashed border-slate-300 bg-white/50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                <AddCategoryButton />
              </div>
            </div>
          </div>

          {/* Month Calendar Section (Below notes/files) */}
          <div className="border-t border-slate-100 pt-5 dark:border-slate-800/80">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Upload Activity (Current Month)
            </h4>
            <div className="max-w-md rounded-xl border border-slate-200/60 bg-white p-4 dark:border-slate-800/60 dark:bg-slate-950/40">
              <MonthCalendar
                year={year}
                month={month}
                activeDays={new Set(client.activeDays)}
                baseHref={`/client-hub/${client.id}`}
                taskDays={taskDays}
                fileActivityDays={client.fileActivityDays}
                canMarkUsed={canMarkUsed}
              />
            </div>
          </div>

          {/* Footer Action */}
          <div className="flex items-center justify-end border-t border-slate-100 pt-4 dark:border-slate-800/80">
            <Link
              href={`/client-hub/${client.id}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/70 backdrop-blur-sm px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-100 hover:scale-[1.01] active:scale-[0.99] dark:border-slate-800/80 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              Go to Full Client Hub Page
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
