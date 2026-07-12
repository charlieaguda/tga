import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { encryptSecret } from "@/lib/credential-crypto";
import { invalidateDriveCache } from "@/lib/drive";

const CONNECTION_ID = "drive_connection";

export async function getDriveConnection() {
  await authorize("drive.manage");

  return db.driveConnection.findUnique({
    where: { id: CONNECTION_ID },
    select: { googleAccountEmail: true, createdAt: true, connectedBy: { select: { name: true } } },
  });
}

export async function connectDrive(input: { googleAccountEmail: string; refreshToken: string }) {
  const actor = await authorize("drive.manage");
  const encryptedRefreshToken = encryptSecret(input.refreshToken);

  await db.driveConnection.upsert({
    where: { id: CONNECTION_ID },
    create: {
      id: CONNECTION_ID,
      googleAccountEmail: input.googleAccountEmail,
      encryptedRefreshToken,
      connectedById: actor.id,
    },
    update: {
      googleAccountEmail: input.googleAccountEmail,
      encryptedRefreshToken,
      connectedById: actor.id,
    },
  });

  await logActivity(db, {
    actorId: actor.id,
    action: "drive.connected",
    entityType: "drive_connection",
    entityId: CONNECTION_ID,
    meta: { googleAccountEmail: input.googleAccountEmail },
  });

  invalidateDriveCache();
}

export async function disconnectDrive() {
  const actor = await authorize("drive.manage");

  await db.driveConnection.deleteMany({ where: { id: CONNECTION_ID } });

  await logActivity(db, {
    actorId: actor.id,
    action: "drive.disconnected",
    entityType: "drive_connection",
    entityId: CONNECTION_ID,
  });

  invalidateDriveCache();
}
