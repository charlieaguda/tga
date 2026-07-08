import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { completeUpload } from "@/lib/services/uploads";
import { errorToStatus } from "@/lib/errors";

const Body = z.object({ driveFileId: z.string().min(1).max(200) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = Body.parse(await req.json());
    const result = await completeUpload(id, body.driveFileId);
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
