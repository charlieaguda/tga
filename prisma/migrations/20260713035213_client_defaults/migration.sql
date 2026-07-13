-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "defaultEditorId" TEXT,
ADD COLUMN     "defaultManagerId" TEXT;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_defaultManagerId_fkey" FOREIGN KEY ("defaultManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_defaultEditorId_fkey" FOREIGN KEY ("defaultEditorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
