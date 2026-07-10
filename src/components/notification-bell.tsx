"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { notificationsMarkAllRead } from "@/lib/actions";

type Item = {
  id: string;
  message: string;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setUnread(data.unread);
      setItems(data.items);
    } catch {
      // polling — ignore transient failures
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white/50 text-slate-700 backdrop-blur-sm transition-all hover:bg-slate-100 hover:scale-105 active:scale-95 dark:border-slate-800/80 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand-600 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 origin-top-right rounded-xl border border-slate-200/80 bg-white/90 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-1 dark:border-slate-800/80 dark:bg-slate-900/90 dark:ring-white/5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-450 dark:hover:text-brand-350 transition-colors"
                onClick={async () => {
                  await notificationsMarkAllRead();
                  load();
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-90 overflow-y-auto p-1">
            {items.length === 0 && (
              <li className="px-3 py-4 text-xs text-slate-400 dark:text-slate-500 text-center">Nothing yet.</li>
            )}
            {items.map((n) => {
              const body = (
                <div className="flex flex-col gap-0.5">
                  <span className={n.readAt ? "text-slate-550 dark:text-slate-450 text-xs" : "font-medium text-slate-900 dark:text-slate-100 text-xs"}>{n.message}</span>
                  <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                    {new Date(n.createdAt).toLocaleString("en-AU", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              );
              return (
                <li key={n.id} className="rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  {n.taskId ? (
                    <Link href={`/tasks/${n.taskId}`} onClick={() => setOpen(false)} className="block px-3 py-2">
                      {body}
                    </Link>
                  ) : (
                    <div className="px-3 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

}
