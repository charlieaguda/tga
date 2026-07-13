import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, requireUser } from "@/lib/permissions";
import { fetchThumbnail } from "@/lib/drive";
import { resolveEditorHasTask } from "@/lib/services/client-files";
import { ValidationError, errorToStatus } from "@/lib/errors";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await ctx.params;
    const file = await db.file.findUnique({ where: { id: fileId } });
    if (!file || !file.clientId) throw new ValidationError("File not found");
    const user = await requireUser();
    const editorHasTask = await resolveEditorHasTask(user, file.clientId);
    await authorize("client.file.read", { client: { id: file.clientId }, editorHasTask });

    const thumb = await fetchThumbnail(file.driveFileId);
    if (!thumb) return NextResponse.json({ error: "No thumbnail available" }, { status: 404 });

    return new NextResponse(thumb.body, {
      headers: {
        "Content-Type": thumb.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const status = errorToStatus(err);
    if (status === 500) console.error("[client-files] thumbnail fetch failed:", err);
    return NextResponse.json(
      { error: status === 500 ? "Thumbnail could not be loaded" : (err as Error).message },
      { status },
    );
  }
}
