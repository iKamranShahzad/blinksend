import { useState, type ReactNode } from "react";
import { LayoutGrid, List } from "lucide-react";
import type { FileTransfer } from "../types/types";

export type TransferView = "list" | "grid";

export function TransferHistory({
  transfers,
  renderTransfer,
}: {
  transfers: FileTransfer[];
  renderTransfer: (transfer: FileTransfer, view: TransferView) => ReactNode;
}) {
  const [view, setView] = useState<TransferView>("list");
  return (
    <section
      aria-label="Transfer history"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-200">
          Transfers{" "}
          <span className="ml-1 text-xs font-normal text-gray-500 dark:text-zinc-400">
            {transfers.length}
          </span>
        </h2>
        <div
          role="group"
          aria-label="Transfer view"
          className="flex rounded-lg border border-gray-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-800"
        >
          {(["list", "grid"] as const).map((option) => (
            <button
              key={option}
              type="button"
              title={option === "list" ? "List view" : "Grid view"}
              aria-label={option === "list" ? "List view" : "Grid view"}
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`flex size-11 items-center justify-center rounded-md transition-colors sm:size-8 ${view === option ? "bg-blue-50 text-blue-700 dark:bg-indigo-900/60 dark:text-indigo-200" : "text-gray-500 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}
            >
              {option === "list" ? (
                <List size={16} aria-hidden="true" />
              ) : (
                <LayoutGrid size={16} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>
      <div
        role="region"
        aria-label="Scrollable transfers"
        tabIndex={0}
        className="transfer-scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        style={{ scrollbarGutter: "stable" }}
      >
        <div
          role="list"
          className={
            view === "grid"
              ? "grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
              : "divide-y divide-gray-100 dark:divide-zinc-800"
          }
        >
          {transfers.map((transfer) => renderTransfer(transfer, view))}
        </div>
      </div>
    </section>
  );
}
