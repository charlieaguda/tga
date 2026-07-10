import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

const STAT_TONES = {
  default: "text-slate-900 dark:text-slate-100",
  brand: "text-brand-600 dark:text-brand-500",
  danger: "text-red-600 dark:text-red-400",
} as const;

export function StatTile({
  value,
  tone = "default",
}: {
  value: number | string;
  tone?: keyof typeof STAT_TONES;
}) {
  return <p className={`text-3xl font-bold tabular-nums ${STAT_TONES[tone]}`}>{value}</p>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

export function FileLink({
  href,
  name,
  sizeBytes,
}: {
  href: string;
  name: string;
  sizeBytes: bigint | number;
}) {
  return (
    <li className="flex items-center gap-2">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-500"
      >
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
          <path d="M14 3v5h5" strokeLinejoin="round" />
        </svg>
        {name}
      </a>
      <span className="text-xs text-slate-400 dark:text-slate-500">
        {(Number(sizeBytes) / 1024 / 1024).toFixed(1)} MB
      </span>
    </li>
  );
}
