-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('BRAND_GUIDELINES', 'ASSETS', 'CREATIVES', 'UNUSED_CREATIVES', 'LOGO', 'BRAND_COLORS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'VIEWER';
ALTER TYPE "Role" ADD VALUE 'CLIENT';

-- DropForeignKey
ALTER TABLE "UploadSession" DROP CONSTRAINT "UploadSession_submissionId_fkey";

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "notionUrl" TEXT,
ADD COLUMN     "offboardedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "category" "FileCategory",
ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "UploadSession" ADD COLUMN     "category" "FileCategory",
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "taskId" TEXT,
ALTER COLUMN "submissionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clientId" TEXT;

-- CreateTable
CREATE TABLE "ClientCategoryFolder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "category" "FileCategory" NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCategoryFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientCategoryFolder_clientId_category_key" ON "ClientCategoryFolder"("clientId", "category");

-- CreateIndex
CREATE INDEX "ActivityLog_clientId_createdAt_idx" ON "ActivityLog"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "File_clientId_category_idx" ON "File"("clientId", "category");

-- CreateIndex
CREATE INDEX "UploadSession_taskId_status_idx" ON "UploadSession"("taskId", "status");

-- CreateIndex
CREATE INDEX "UploadSession_clientId_status_idx" ON "UploadSession"("clientId", "status");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCategoryFolder" ADD CONSTRAINT "ClientCategoryFolder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
