-- Job gets an optional default editor: pre-fills the assignee when creating new tasks under it.
ALTER TABLE "Job" ADD COLUMN "defaultEditorId" TEXT;
ALTER TABLE "Job" ADD CONSTRAINT "Job_defaultEditorId_fkey" FOREIGN KEY ("defaultEditorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
