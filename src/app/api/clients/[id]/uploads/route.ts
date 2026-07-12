import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClientUploadSession } from "@/lib/services/client-files";
import { errorToStatus } from "@/lib/errors";

const Body = z.object({
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1).max(150),
  category: z.string().min(1).max(64),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = Body.parse(await req.json());
    const result = await createClientUploadSession(id, body.category, body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const status = errorToStatus(err);
    if (status === 500) console.error("[client-uploads] create failed:", err);
    return NextResponse.json(
      { error: status === 500 ? "Upload could not be started" : (err as Error).message },
      { status },
    );
  }
}
