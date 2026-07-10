import { FileCategory } from "@prisma/client";

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  BRAND_GUIDELINES: "Brand Guidelines (PDF)",
  ASSETS: "Assets",
  CREATIVES: "Creatives",
  UNUSED_CREATIVES: "Unused Creatives",
  LOGO: "Logo",
  BRAND_COLORS: "Brand Colors",
};

export const FILE_CATEGORIES = Object.values(FileCategory);

// Categories a CLIENT-role user may upload into directly — brand-supplied
// material only. Creatives/Unused Creatives are staff output; a client
// shouldn't be able to overwrite what staff produced.
export const CLIENT_WRITABLE_CATEGORIES = new Set<FileCategory>([
  FileCategory.BRAND_GUIDELINES,
  FileCategory.ASSETS,
  FileCategory.LOGO,
  FileCategory.BRAND_COLORS,
]);
