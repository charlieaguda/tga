import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { authorize, requireUser } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { ValidationError } from "@/lib/errors";

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LEN = 8;

// Compared against when the email doesn't exist, so lookup misses take the
// same time as password mismatches (no account enumeration via timing).
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString("hex"), BCRYPT_ROUNDS);

function assertPasswordPolicy(password: string) {
  if (password.length < MIN_PASSWORD_LEN)
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
  if (password.length > 200) throw new ValidationError("Password is too long");
}

/** Returns the user on success, null on any failure (caller shows one generic error). */
export async function verifyLogin(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!ok || !user?.isActive || !user.passwordHash) return null;
  return user;
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Admin sets/resets any user's password; all their sessions are revoked. */
export async function adminSetPassword(userId: string, newPassword: string) {
  const actor = await authorize("user.manage");
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new ValidationError("User not found");
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "user.password_reset",
      entityType: "user",
      entityId: userId,
    });
  });
}

/** User changes their own password; requires the current one. */
export async function changeOwnPassword(currentPassword: string, newPassword: string) {
  const actor = await requireUser();
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash ?? DUMMY_HASH);
  if (!ok || !user.passwordHash) throw new ValidationError("Current password is incorrect");
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash } });
    // Revoke every session (including this one — the user signs in again).
    await tx.session.deleteMany({ where: { userId: actor.id } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "user.password_changed",
      entityType: "user",
      entityId: actor.id,
    });
  });
}
