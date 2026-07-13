import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, requireUser } from "@/lib/permissions";
import { fetchFileContent } from "@/lib/drive";
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

    const content = await fetchFileContent(file.driveFileId);
    return new NextResponse(content.body, {
      headers: {
        "Content-Type": content.contentType,
        "Content-Length": String(content.sizeBytes),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "script-src 'none'; sandbox;",
      },
    });
  } catch (err) {
    const status = errorToStatus(err);
    if (status === 500) console.error("[client-files] content fetch failed:", err);
    return NextResponse.json(
      { error: status === 500 ? "File could not be loaded" : (err as Error).message },
      { status },
    );
  }
}
