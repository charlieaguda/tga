"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { clientFileMove } from "@/lib/actions";

export function CategoryDropZone({
  categoryKey,
  className,
  children,
}: {
  categoryKey: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isOver, setIsOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const raw = e.dataTransfer.getData("application/json");
        if (!raw) return;
        let dragged: { fileId: string; category: string };
        try {
          dragged = JSON.parse(raw);
        } catch {
          return;
        }
        if (!dragged.fileId || dragged.category === categoryKey) return;
        setError(null);
        startTransition(async () => {
          const res = await clientFileMove(dragged.fileId, categoryKey);
          if (!res.ok) setError(res.error ?? "Could not move file");
          else router.refresh();
        });
      }}
      className={`${className ?? ""} transition-all ${isOver ? "ring-2 ring-brand-500 ring-offset-1" : ""} ${pending ? "opacity-70" : ""}`}
    >
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
