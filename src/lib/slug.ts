export function slugify(input: string, maxLen = 60): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, maxLen)
      .replace(/^-|-$/g, "") || "untitled"
  );
}

/** Strip path separators and control chars from a user-supplied file name. */
export function sanitizeFileName(name: string, maxLen = 120): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.replace(/[\x00-\x1f<>:"|?*]/g, "").trim();
  return (clean || "file").slice(-maxLen);
}
