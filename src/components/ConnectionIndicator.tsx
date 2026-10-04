import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "../types/types";

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
  restoring: boolean;
  error: string;
  onRetry: () => void;
}

export function ConnectionIndicator({
  status,
  restoring,
  error,
  onRetry,
}: ConnectionIndicatorProps) {
  const tooltipId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const connected = status === "connected" && !restoring;
  const canRetry = ["error", "reconnecting", "offline"].includes(status);
  const label = {
    connecting: "Connecting…",
    connected: restoring ? "Restoring room…" : "Connected",
    reconnecting: "Reconnecting…",
    offline: "You are offline",
    error: "Connection unavailable",
  }[status];

  useEffect(() => {
    if (!pinned) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setPinned(false);
        setDismissed(true);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [pinned]);

  return (
    <div
      ref={container}
      className="group fixed top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] z-50"
      onPointerEnter={() => setDismissed(false)}
    >
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {label}
      </span>
      <button
        type="button"
        aria-label={canRetry ? `${label}. Retry connection` : label}
        aria-describedby={tooltipId}
        onClick={() => {
          setPinned(!pinned);
          setDismissed(pinned);
          if (canRetry) onRetry();
        }}
        onFocus={() => setDismissed(false)}
        onBlur={() => setPinned(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPinned(false);
            setDismissed(true);
          }
        }}
        className={`flex size-11 items-center justify-center rounded-full transition-colors hover:bg-gray-200/60 dark:hover:bg-zinc-800 ${
          connected
            ? "text-green-600 dark:text-green-400"
            : status === "offline" || status === "error"
              ? "text-gray-500 dark:text-zinc-400"
              : "text-amber-600 dark:text-amber-400"
        }`}
      >
        {connected ? (
          <Wifi size={18} aria-hidden="true" />
        ) : status === "error" || status === "offline" ? (
          <WifiOff size={18} aria-hidden="true" />
        ) : (
          <RefreshCw
            size={18}
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        )}
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        className={`absolute top-full left-0 w-max max-w-[min(20rem,calc(100vw-2rem))] pt-2 transition-opacity ${pinned && !dismissed ? "visible opacity-100" : "invisible opacity-0"} ${
          dismissed
            ? ""
            : "group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
        }`}
      >
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-200">
          <p className="font-medium">{label}</p>
          {error && <p className="mt-1">{error}</p>}
          {canRetry && (
            <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
              Click or tap the icon to retry
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
