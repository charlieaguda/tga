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
    <div className="flex flex-wrap items-start justify-between gap-3 pb-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent dark:from-white dark:to-slate-300">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
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
    <section className="rounded-2xl border border-slate-200/70 bg-white/60 backdrop-blur-md p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.04)] dark:border-slate-800/60 dark:bg-slate-900/40 dark:shadow-none">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
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
  return <p className={`text-4xl font-extrabold tracking-tight tabular-nums ${STAT_TONES[tone]}`}>{value}</p>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

export function FileLink({
  href,
  name,
  sizeBytes,
  description,
  extra,
}: {
  href: string;
  name: string;
  sizeBytes: bigint | number;
  description?: string | null;
  extra?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-slate-200/60 bg-slate-50/50 px-3.5 py-2 hover:bg-slate-100/50 dark:border-slate-800/40 dark:bg-slate-800/20 dark:hover:bg-slate-800/40 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-500 transition-colors truncate"
        >
          <svg className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
            <path d="M14 3v5h5" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{name}</span>
        </a>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {(Number(sizeBytes) / 1024 / 1024).toFixed(1)} MB
          </span>
          {extra}
        </div>
      </div>
      {description && (
        <p className="pl-6 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap leading-relaxed border-t border-slate-100/50 pt-1.5 dark:border-slate-800/20">
          {description}
        </p>
      )}
    </li>
  );
}

