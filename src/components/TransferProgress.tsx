import React from "react";
import { FileTransfer } from "../types/types";

interface TransferProgressProps {
  transfer: FileTransfer;
}

export const TransferProgress: React.FC<TransferProgressProps> = ({
  transfer,
}) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  };

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="font-medium text-gray-900">{transfer.fileName}</div>
          <div className="text-sm text-gray-500">
            {formatFileSize(transfer.fileSize)}
          </div>
        </div>
        <div
          className={`text-sm ${
            transfer.status === "completed"
              ? "text-green-500"
              : transfer.status === "error"
                ? "text-red-500"
                : "text-blue-500"
          }`}
        >
          {transfer.status.charAt(0).toUpperCase() + transfer.status.slice(1)}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full transition-all duration-200 ${
            transfer.status === "completed"
              ? "bg-green-500"
              : transfer.status === "error"
                ? "bg-red-500"
                : "bg-blue-500"
          }`}
          style={{ width: `${transfer.progress}%` }}
        />
      </div>
    </div>
  );
};
