import type { FileTransfer } from "../types/types";
import type { TransferView } from "./TransferHistory";
import {
  X,
  File,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Pause,
  Play,
} from "lucide-react";
import { formatFileSize } from "../utils/fileUtils";

interface TransferProgressProps {
  transfer: FileTransfer;
  view?: TransferView;
  onRemove?: (id: string) => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onPause?: (paused: boolean) => void;
  retryDisabled?: boolean;
}

export function TransferProgress({
  transfer,
  view = "list",
  onRemove,
  onCancel,
  onRetry,
  onPause,
  retryDisabled,
}: TransferProgressProps) {
  const finished = ["completed", "error", "cancelled"].includes(
    transfer.status,
  );
  const active = [
    "pending",
    "transferring",
    "receiving",
    "finalizing",
  ].includes(transfer.status);
  const labels: Record<FileTransfer["status"], string> = {
    queued: "Queued",
    pending: "Connecting",
    transferring: "Sending",
    receiving: "Receiving",
    finalizing: "Verifying",
    completed: "Completed",
    error: "Failed",
    cancelled: "Cancelled",
    paused: transfer.direction === "receive" ? "Sender paused" : "Paused",
  };
  const actionClass =
    "flex size-11 shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 sm:size-8 dark:text-gray-300 dark:hover:bg-zinc-700";
  const status = (
    <span
      role="status"
      className={
        "inline-flex shrink-0 items-center gap-1.5 text-xs " +
        (transfer.status === "error"
          ? "text-red-600 dark:text-red-400"
          : transfer.status === "completed"
            ? "text-green-600 dark:text-green-400"
            : transfer.status === "cancelled"
              ? "text-gray-500 dark:text-zinc-400"
              : "text-blue-700 dark:text-blue-400")
      }
    >
      {transfer.status === "completed" ? (
        <CheckCircle2 size={14} aria-hidden="true" />
      ) : transfer.status === "error" ? (
        <AlertCircle size={14} aria-hidden="true" />
      ) : active ? (
        <RefreshCw
          size={14}
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {labels[transfer.status]}
      {["transferring", "receiving"].includes(transfer.status) &&
        " · " + transfer.progress + "%"}
    </span>
  );
  return (
    <div
      role="listitem"
      className={
        view === "grid"
          ? "relative min-w-0 rounded-lg border border-gray-200 bg-gray-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50"
          : "relative min-w-0 px-2 py-2"
      }
    >
      <div className="flex items-center gap-2">
        <File
          size={16}
          aria-hidden="true"
          className="shrink-0 text-blue-600 dark:text-blue-400"
        />
        <div className="min-w-0 flex-1">
          <p
            title={transfer.fileName}
            className="truncate text-sm font-medium text-gray-900 dark:text-gray-200"
          >
            {transfer.fileName}
          </p>
          <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-zinc-400">
            {formatFileSize(transfer.fileSize)}
            {transfer.peerName &&
              " · " +
                (transfer.direction === "receive" ? "From " : "To ") +
                transfer.peerName}
          </p>
        </div>
        {view === "list" && <div className="hidden sm:block">{status}</div>}
        <div className="flex shrink-0 items-center gap-1">
          {transfer.direction === "send" &&
            ["transferring", "paused"].includes(transfer.status) &&
            onPause && (
              <button
                onClick={() => onPause(transfer.status !== "paused")}
                aria-label={
                  (transfer.status === "paused" ? "Resume " : "Pause ") +
                  transfer.fileName
                }
                title={transfer.status === "paused" ? "Resume" : "Pause"}
                className={actionClass}
              >
                {transfer.status === "paused" ? (
                  <Play size={15} aria-hidden="true" />
                ) : (
                  <Pause size={15} aria-hidden="true" />
                )}
              </button>
            )}
          {!finished && onCancel && (
            <button
              onClick={onCancel}
              aria-label={"Cancel " + transfer.fileName}
              title="Cancel"
              className={actionClass}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
          {transfer.direction === "send" &&
            ["error", "cancelled"].includes(transfer.status) &&
            onRetry && (
              <button
                onClick={onRetry}
                disabled={retryDisabled}
                aria-label={"Retry " + transfer.fileName}
                title="Retry"
                className={actionClass}
              >
                <RefreshCw size={15} aria-hidden="true" />
              </button>
            )}
          {finished && onRemove && (
            <button
              onClick={() => onRemove(transfer.id)}
              aria-label={"Remove " + transfer.fileName}
              title="Remove from list"
              className={actionClass}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {(view === "grid" || !finished) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {view === "grid" ? (
            status
          ) : (
            <span className="sm:hidden">{status}</span>
          )}
          {active && (transfer.bytesPerSecond || 0) > 0 && (
            <span className="ml-auto text-xs text-gray-500 dark:text-zinc-400">
              {formatFileSize(
                Math.max(1, Math.round(transfer.bytesPerSecond!)),
              )}
              /s
              {transfer.remainingSeconds !== undefined &&
                " · " +
                  (transfer.remainingSeconds < 60
                    ? transfer.remainingSeconds + "s"
                    : Math.ceil(transfer.remainingSeconds / 60) + "m") +
                  " left"}
            </span>
          )}
        </div>
      )}
      {view === "list" && finished && (
        <div className="mt-1 sm:hidden">{status}</div>
      )}
      {transfer.error && (
        <p
          title={transfer.error}
          className="mt-1 line-clamp-2 text-xs break-words text-red-600 dark:text-red-400"
        >
          {transfer.error}
        </p>
      )}
      <div
        role="progressbar"
        aria-label={transfer.fileName + " progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={transfer.progress}
        className={
          finished
            ? "sr-only"
            : "mt-2 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700"
        }
      >
        <div
          className={
            "h-full bg-blue-500 transition-all duration-200 motion-reduce:transition-none"
          }
          style={{ width: transfer.progress + "%" }}
        />
      </div>
    </div>
  );
}
