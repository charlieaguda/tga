import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { ConflictError, ValidationError } from "@/lib/errors";
import { slugify } from "@/lib/slug";

export async function listCategories() {
  return db.category.findMany({ orderBy: { createdAt: "asc" } });
}

export async function createCategory(input: { label: string; clientWritable: boolean }) {
  const actor = await authorize("category.write");
  const label = input.label.trim();
  if (!label) throw new ValidationError("Category name is required");
  const key = slugify(label, 40).toUpperCase().replace(/-/g, "_");

  try {
    const category = await db.category.create({
      data: { key, label, clientWritable: input.clientWritable },
    });
    await logActivity(db, {
      actorId: actor.id,
      action: "category.created",
      entityType: "category",
      entityId: category.id,
      meta: { key, label, clientWritable: input.clientWritable },
    });
    return category;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002")
      throw new ConflictError("A category with that name already exists");
    throw err;
  }
}
