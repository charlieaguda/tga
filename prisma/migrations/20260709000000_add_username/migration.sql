-- Add username as the sign-in identifier; email becomes optional (used only for notification emails).
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- Backfill any existing rows (none expected in a fresh dev DB) before enforcing NOT NULL + uniqueness.
UPDATE "User" SET "username" = LOWER(SPLIT_PART("email", '@', 1)) WHERE "username" IS NULL AND "email" IS NOT NULL;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
