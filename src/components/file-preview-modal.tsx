"use client";

export function FilePreviewModal({
  file,
  onClose,
}: {
  file: { id: string; driveFileId: string; storedName: string; mimeType: string };
  onClose: () => void;
}) {
  const isImage = file.mimeType.startsWith("image/");
  const isVideo = file.mimeType.startsWith("video/");
  const isPdf = file.mimeType === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
            {file.storedName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/client-files/${file.id}/content`}
              alt={file.storedName}
              className="mx-auto max-h-[75vh] max-w-full object-contain"
            />
          )}
          {isPdf && (
            <embed
              src={`/api/client-files/${file.id}/content`}
              type="application/pdf"
              className="h-[75vh] w-full rounded-lg"
            />
          )}
          {isVideo && (
            <iframe
              src={`https://drive.google.com/file/d/${file.driveFileId}/preview`}
              className="h-[70vh] w-full rounded-lg"
              allow="autoplay"
            />
          )}
          {!isImage && !isPdf && !isVideo && (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No in-app preview for this file type.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
