export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isOverdue(task: { dueAt: Date | null; status: string }): boolean {
  return (
    !!task.dueAt &&
    task.dueAt.getTime() < Date.now() &&
    !["POSTED", "CANCELLED"].includes(task.status)
  );
}
