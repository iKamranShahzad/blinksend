import React, { useState, useEffect } from "react";
import { FileTransfer } from "../types/types";
import { X, File, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

interface TransferProgressProps {
  transfer: FileTransfer;
  onRemove?: (id: string) => void;
}

export const TransferProgress: React.FC<TransferProgressProps> = ({
  transfer,
  onRemove,
}) => {
  const [showRemoveButton, setShowRemoveButton] = useState(false);
  const [animateProgress, setAnimateProgress] = useState(false);

  useEffect(() => {
    if (transfer.status === "transferring") {
      setAnimateProgress(true);
      const timer = setTimeout(() => setAnimateProgress(false), 700);
      return () => clearTimeout(timer);
    }
  }, [transfer.progress, transfer.status]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  };

  const isFinished =
    transfer.status === "completed" || transfer.status === "error";

  const fileExtension = transfer.fileName.split(".").pop()?.toLowerCase() || "";

  const getFileColor = () => {
    const imageTypes = ["jpg", "jpeg", "png", "gif", "webp"];
    const documentTypes = ["pdf", "doc", "docx", "txt", "xlsx"];
    const videoTypes = ["mp4", "mov", "avi", "webm"];

    if (imageTypes.includes(fileExtension)) return "text-blue-500";
    if (documentTypes.includes(fileExtension)) return "text-orange-500";
    if (videoTypes.includes(fileExtension)) return "text-purple-500";
    return "text-gray-500";
  };

  return (
    <div
      className="relative rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-all duration-200 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800/50"
      onMouseEnter={() => isFinished && setShowRemoveButton(true)}
      onMouseLeave={() => setShowRemoveButton(false)}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 ${getFileColor()}`}>
          <File size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between">
            <div className="truncate font-medium text-gray-900 dark:text-gray-200">
              {transfer.fileName}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 sm:ml-2 sm:mt-0">
              {formatFileSize(transfer.fileSize)}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {transfer.status === "transferring" && (
                <RefreshCw size={14} className="animate-spin text-blue-500" />
              )}
              {transfer.status === "completed" && (
                <CheckCircle2 size={14} className="text-green-500" />
              )}
              {transfer.status === "error" && (
                <AlertCircle size={14} className="text-red-500" />
              )}
              <div
                className={`text-xs font-medium ${
                  transfer.status === "completed"
                    ? "text-green-600 dark:text-green-400"
                    : transfer.status === "error"
                      ? "text-red-600 dark:text-red-400"
                      : "text-blue-600 dark:text-blue-400"
                }`}
              >
                {transfer.status === "transferring"
                  ? `${transfer.progress}%`
                  : transfer.status.charAt(0).toUpperCase() +
                    transfer.status.slice(1)}
              </div>
            </div>
          </div>
        </div>

        {(showRemoveButton || isFinished) && onRemove && (
          <button
            onClick={() => onRemove(transfer.id)}
            className="right-3 top-3 rounded-full p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700"
            aria-label="Remove"
            title="Remove from list"
          >
            <X size={16} className="text-gray-500 dark:text-gray-400" />
          </button>
        )}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700">
        <div
          className={`h-full transition-all duration-500 ${
            transfer.status === "completed"
              ? "bg-green-500"
              : transfer.status === "error"
                ? "bg-red-500"
                : animateProgress
                  ? "pulse-animation bg-blue-400"
                  : "bg-blue-500"
          } ${transfer.status === "transferring" ? "progress-shimmer" : ""}`}
          style={{ width: `${transfer.progress}%` }}
        />
      </div>
    </div>
  );
};
