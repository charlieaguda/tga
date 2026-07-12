-- Convert FileCategory from a fixed enum to an admin-managed Category table,
-- so staff can add new categories without a schema migration. Existing values
-- are cast column-in-place (not dropped) so no File/UploadSession/
-- ClientCategoryFolder rows lose their category assignment.

-- AlterTable: cast enum -> text, preserving existing values
ALTER TABLE "ClientCategoryFolder" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;
ALTER TABLE "File" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;
ALTER TABLE "UploadSession" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;

-- DropEnum
DROP TYPE "FileCategory";

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "clientWritable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_key_key" ON "Category"("key");

-- Note: unique index on ClientCategoryFolder(clientId, category) and the
-- index on File(clientId, category) already exist from the client_hub
-- migration and survive the column type change untouched — not recreated here.

-- Seed rows matching the previous FileCategory enum values, so existing
-- File/UploadSession/ClientCategoryFolder rows keep resolving to a real
-- Category (clientWritable matches the old CLIENT_WRITABLE_CATEGORIES set).
INSERT INTO "Category" ("id", "key", "label", "clientWritable") VALUES
    ('cat_brand_guidelines', 'BRAND_GUIDELINES', 'Brand Guidelines (PDF)', true),
    ('cat_assets', 'ASSETS', 'Assets', true),
    ('cat_creatives', 'CREATIVES', 'Creatives', false),
    ('cat_unused_creatives', 'UNUSED_CREATIVES', 'Unused Creatives', false),
    ('cat_logo', 'LOGO', 'Logo', true),
    ('cat_brand_colors', 'BRAND_COLORS', 'Brand Colors', true);
