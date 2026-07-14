export interface UploadedFile {
  fileId: string;
  name: string;
  actorName: string;
}

export interface CategoryUploadGroup {
  categoryKey: string;
  categoryLabel: string;
  driveFolderId: string | null;
  files: UploadedFile[];
  allUsed: boolean;
}

export type FileActivityDaysMap = Record<string, CategoryUploadGroup[]>;

export function buildFileActivityDaysMap(
  rows: {
    entityId: string;
    createdAt: Date;
    actor: { name: string | null } | null;
  }[],
  categories: { key: string; label: string }[],
  filesById: Map<string, { category: string | null; storedName: string; markedUsed: boolean }>,
  folderIdByCategory: Map<string, string>,
): FileActivityDaysMap {
  const labelOf = new Map(categories.map((c) => [c.key, c.label]));

  // Group upload events by day, then by the file's current category within that day.
  const byDay = new Map<string, Map<string, { fileId: string; name: string; actorName: string; markedUsed: boolean }[]>>();
  for (const row of rows) {
    const file = filesById.get(row.entityId);
    if (!file || !file.category) continue; // deleted or non-category file — nothing to show/act on
    const dayKey = row.createdAt.toISOString().slice(0, 10);
    const byCategory = byDay.get(dayKey) ?? new Map();
    byDay.set(dayKey, byCategory);
    const files = byCategory.get(file.category) ?? [];
    byCategory.set(file.category, files);
    files.push({
      fileId: row.entityId,
      name: file.storedName,
      actorName: row.actor?.name ?? "Someone",
      markedUsed: file.markedUsed,
    });
  }

  const map: FileActivityDaysMap = {};
  for (const [dayKey, byCategory] of byDay) {
    map[dayKey] = [...byCategory.entries()].map(([categoryKey, files]) => ({
      categoryKey,
      categoryLabel: labelOf.get(categoryKey) ?? categoryKey,
      driveFolderId: folderIdByCategory.get(categoryKey) ?? null,
      files: files.map(({ fileId, name, actorName }) => ({ fileId, name, actorName })),
      allUsed: files.every((f) => f.markedUsed),
    }));
  }
  return map;
}
