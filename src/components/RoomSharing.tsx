import { ArrowLeftRight, Copy, Link } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface RoomSharingProps {
  roomId: string;
  invitationUrl: string;
  onCopyCode: () => void;
  onCopyLink: () => void;
}

export function RoomQRCode({
  roomId,
  invitationUrl,
  size = 128,
}: Pick<RoomSharingProps, "roomId" | "invitationUrl"> & { size?: number }) {
  return (
    <QRCodeSVG
      value={invitationUrl}
      size={size}
      level="M"
      marginSize={4}
      bgColor="#ffffff"
      fgColor="#18181b"
      role="img"
      title={`Scan to join room ${roomId}`}
      aria-label={`Scan to join room ${roomId}`}
      className="rounded-lg"
    />
  );
}

export function RoomInvitation({
  roomId,
  invitationUrl,
  onCopyCode,
  onCopyLink,
}: RoomSharingProps) {
  return (
    <div className="rounded-xl border border-blue-200 bg-linear-to-br/srgb from-blue-50 to-blue-100 px-4 py-5 text-center shadow-xs md:px-8 dark:border-indigo-800 dark:from-indigo-900/40 dark:to-violet-900/20">
      <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-indigo-800/60 dark:text-indigo-300">
        <ArrowLeftRight size={24} aria-hidden="true" />
      </div>
      <h3 className="mb-5 text-base font-medium text-blue-800 dark:text-indigo-200">
        Ready to Share
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="flex min-w-0 flex-col items-center gap-5 px-2 md:border-r md:border-blue-200 md:px-8 dark:md:border-indigo-800">
          <section className="w-full max-w-xs">
            <h4 className="mb-2 text-sm font-medium text-blue-800 dark:text-indigo-200">
              Room code
            </h4>
            <button
              type="button"
              onClick={onCopyCode}
              aria-label={`Copy room code ${roomId}`}
              title="Copy room code"
              className="flex min-h-11 w-full items-center justify-center gap-3 rounded-lg bg-white/80 px-3 text-blue-800 transition-colors hover:bg-white dark:bg-indigo-900/60 dark:text-indigo-100 dark:hover:bg-indigo-800"
            >
              <span className="font-mono text-lg font-bold tracking-wider">
                {roomId}
              </span>
              <Copy size={16} aria-hidden="true" className="shrink-0" />
            </button>
            <p className="mt-2 text-xs leading-relaxed text-blue-700 dark:text-indigo-300">
              Enter on another device
            </p>
          </section>
          <section className="w-full max-w-xs">
            <h4 className="mb-2 text-sm font-medium text-blue-800 dark:text-indigo-200">
              Invite link
            </h4>
            <div className="flex min-h-11 w-full min-w-0 items-center rounded-lg bg-white/80 pl-3 text-blue-800 dark:bg-indigo-900/60 dark:text-indigo-100">
              <input
                readOnly
                aria-label="Invitation link"
                value={invitationUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-sm bg-transparent text-base sm:text-sm"
              />
              <button
                type="button"
                onClick={onCopyLink}
                aria-label="Copy invitation link"
                title="Copy invitation link"
                className="flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white dark:hover:bg-indigo-800"
              >
                <Link size={16} aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-blue-700 dark:text-indigo-300">
              Open to join instantly
            </p>
          </section>
        </div>
        <section className="hidden flex-col items-center justify-center px-8 md:flex">
          <h4 className="mb-3 text-sm font-medium text-blue-800 dark:text-indigo-200">
            QR code
          </h4>
          <RoomQRCode roomId={roomId} invitationUrl={invitationUrl} />
          <p className="mt-3 text-xs leading-relaxed text-blue-700 dark:text-indigo-300">
            Scan to join
          </p>
        </section>
      </div>
    </div>
  );
}
export function RoomQRShortcut({
  roomId,
  invitationUrl,
}: Pick<RoomSharingProps, "roomId" | "invitationUrl">) {
  return (
    <aside
      aria-label="Room QR invitation"
      className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-[max(1.5rem,env(safe-area-inset-left))] z-20 hidden flex-col items-center gap-2 md:flex"
    >
      <div className="text-center text-blue-700 dark:text-indigo-300">
        <p className="text-sm font-medium">Scan to Join</p>
        <svg
          width="64"
          height="24"
          viewBox="0 0 92 40"
          fill="none"
          aria-hidden="true"
          className="mx-auto mt-1 rotate-180"
        >
          <path
            d="M76 34C56 40 70 15 54 25C36 37 28 27 40 15L46 5M46 5L37 9M46 5L49 14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-xs dark:border-zinc-700 dark:bg-zinc-800">
        <RoomQRCode roomId={roomId} invitationUrl={invitationUrl} />
      </div>
    </aside>
  );
}
