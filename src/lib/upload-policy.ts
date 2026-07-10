import { ForbiddenError, ValidationError } from "@/lib/errors";
import { getFileInfo, type DriveFileInfo } from "@/lib/drive";

export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3; // 5 GiB per file

export function mimeAllowed(mime: string): boolean {
  return mime.startsWith("video/") || mime.startsWith("image/") || mime === "application/pdf";
}

export function assertValidUploadDeclaration(input: { sizeBytes: number; mimeType: string }) {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0)
    throw new ValidationError("Invalid file size");
  if (input.sizeBytes > MAX_UPLOAD_BYTES)
    throw new ValidationError("File exceeds the 5 GB upload limit");
  if (!mimeAllowed(input.mimeType))
    throw new ValidationError("Only video, image, and PDF files are accepted");
}

/**
 * Never trust the client's claim — verify the completed upload against Drive
 * itself before recording it. Shared by every upload-completion path
 * (deliverable / task attachment / client-hub category).
 */
export async function verifyDriveUpload(params: {
  driveFileId: string;
  uploadSessionId: string;
  expectedFolderId: string | null;
  declaredSize: bigint;
}): Promise<DriveFileInfo> {
  const info = await getFileInfo(params.driveFileId);
  if (!info) throw new ValidationError("Uploaded file not found in Drive");
  if (info.appProperties.uploadSessionId !== params.uploadSessionId)
    throw new ForbiddenError("File does not belong to this upload session");
  if (!params.expectedFolderId || !info.parents.includes(params.expectedFolderId))
    throw new ValidationError("File landed in an unexpected folder");
  if (BigInt(info.size) !== params.declaredSize)
    throw new ValidationError("Uploaded size does not match the declared size");
  if (!mimeAllowed(info.mimeType))
    throw new ValidationError("Drive detected a file type that is not accepted");
  return info;
}
