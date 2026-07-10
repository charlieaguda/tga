import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { completeTaskAttachmentUpload, completeUpload } from "@/lib/services/uploads";
import { completeClientUpload } from "@/lib/services/client-files";
import { ValidationError, errorToStatus } from "@/lib/errors";

const Body = z.object({ driveFileId: z.string().min(1).max(200) });

// This endpoint is entity-agnostic: it dispatches to the right completion
// function based on which target field is set on the loaded session (only
// one of submissionId/clientId/taskId is ever set, see UploadSession model).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = Body.parse(await req.json());

    const session = await db.uploadSession.findUnique({
      where: { id },
      select: { submissionId: true, clientId: true, taskId: true },
    });
    if (!session) throw new ValidationError("Upload session not found");

    const result = session.submissionId
      ? await completeUpload(id, body.driveFileId)
      : session.clientId
        ? await completeClientUpload(id, body.driveFileId)
        : session.taskId
          ? await completeTaskAttachmentUpload(id, body.driveFileId)
          : (() => {
              throw new ValidationError("Upload session has no target");
            })();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const status = errorToStatus(err);
    if (status === 500) console.error("[uploads] complete failed:", err);
    return NextResponse.json(
      { error: status === 500 ? "Upload could not be confirmed" : (err as Error).message },
      { status },
    );
  }
}
