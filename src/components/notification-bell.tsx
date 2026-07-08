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
        className="relative rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold uppercase text-gray-500">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={async () => {
                  await notificationsMarkAllRead();
                  load();
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-2 py-3 text-sm text-gray-500">Nothing yet.</li>
            )}
            {items.map((n) => {
              const body = (
                <>
                  <span className={n.readAt ? "text-gray-500" : "font-medium"}>{n.message}</span>
                  <span className="block text-xs text-gray-400">
                    {new Date(n.createdAt).toLocaleString("en-AU", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              );
              return (
                <li key={n.id} className="rounded-md px-2 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                  {n.taskId ? (
                    <Link href={`/tasks/${n.taskId}`} onClick={() => setOpen(false)}>
                      {body}
                    </Link>
                  ) : (
                    body
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
