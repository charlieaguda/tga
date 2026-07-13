import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { fetchFileContent } from "@/lib/drive";
import { ValidationError, errorToStatus } from "@/lib/errors";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await ctx.params;
    const file = await db.file.findUnique({ where: { id: fileId } });
    if (!file || !file.clientId) throw new ValidationError("File not found");
    await authorize("client.file.read", { client: { id: file.clientId } });

    const content = await fetchFileContent(file.driveFileId);
    return new NextResponse(content.body, {
      headers: {
        "Content-Type": content.contentType,
        "Content-Length": String(content.sizeBytes),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const status = errorToStatus(err);
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
