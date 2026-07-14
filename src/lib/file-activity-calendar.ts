import { describeActivity } from "@/lib/activity-descriptions";

export interface FileActivityEntry {
  id: string;
  actorName: string;
  description: string;
  createdAt: Date;
}

export type FileActivityDaysMap = Record<string, FileActivityEntry[]>;

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
      description: describeActivity(row.action, row.meta, categoryLabel),
      createdAt: row.createdAt,
    });
  }
  return map;
}
