export const FILE_ACTIVITY_ACTIONS = [
  "file.uploaded",
  "file.deleted",
  "file.category_changed",
  "file.description.updated",
] as const;

export interface FileActivityEntry {
  id: string;
  actorName: string;
  description: string;
  createdAt: Date;
}

export type FileActivityDaysMap = Record<string, FileActivityEntry[]>;

export function describeFileActivity(
  action: string,
  meta: unknown,
  categoryLabel: (key: string) => string,
): string {
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
  const name = (v: unknown) => (typeof v === "string" && v ? v : "a file");
  switch (action) {
    case "file.uploaded":
      return `uploaded ${name(m.name)} to ${categoryLabel(String(m.category ?? ""))}`;
    case "file.deleted":
      return `deleted ${name(m.name)}`;
    case "file.category_changed":
      return `moved ${name(m.name)} from ${categoryLabel(String(m.from ?? ""))} to ${categoryLabel(String(m.to ?? ""))}`;
    case "file.description.updated":
      return `updated the description of ${name(m.name)}`;
    default:
      return action;
  }
}

export function buildFileActivityDaysMap(
  rows: {
    id: bigint;
    action: string;
    meta: unknown;
    createdAt: Date;
    actor: { name: string | null } | null;
  }[],
  categories: { key: string; label: string }[],
): FileActivityDaysMap {
  const labelOf = new Map(categories.map((c) => [c.key, c.label]));
  const categoryLabel = (key: string) => labelOf.get(key) ?? key;
  const map: FileActivityDaysMap = {};
  for (const row of rows) {
    const key = row.createdAt.toISOString().slice(0, 10);
    (map[key] ??= []).push({
      id: row.id.toString(),
      actorName: row.actor?.name ?? "Someone",
      description: describeFileActivity(row.action, row.meta, categoryLabel),
      createdAt: row.createdAt,
    });
  }
  return map;
}
