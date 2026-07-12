-- CreateTable
CREATE TABLE "DriveConnection" (
    "id" TEXT NOT NULL DEFAULT 'drive_connection',
    "googleAccountEmail" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveConnection_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
