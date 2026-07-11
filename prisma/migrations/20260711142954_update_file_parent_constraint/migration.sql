-- Drop old constraint that required either submissionId XOR taskId
ALTER TABLE "File" DROP CONSTRAINT IF EXISTS file_one_parent;

-- Add updated constraint that allows clientId as well
ALTER TABLE "File" ADD CONSTRAINT file_one_parent
  CHECK (num_nonnulls("submissionId", "taskId", "clientId") = 1);