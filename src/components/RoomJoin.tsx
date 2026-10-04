import React, { useState } from "react";
import { DoorClosed } from "lucide-react";
import { toast } from "sonner";

interface RoomJoinProps {
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  disabled?: boolean;
  pending?: boolean;
  error?: string;
}

export const RoomJoin: React.FC<RoomJoinProps> = ({
  onCreateRoom,
  onJoinRoom,
  disabled = false,
  pending = false,
  error,
}) => {
  const [roomId, setRoomId] = useState("");

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (!/^\d{5}$/.test(roomId)) {
      toast.error("Enter a five-digit room code.");
      return;
    }

    onJoinRoom(roomId);
  };

  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mb-4 text-center text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      <div className="flex flex-col items-center justify-center gap-8 p-6 sm:flex-row">
        <div className="flex w-full flex-col items-center rounded-lg border border-gray-200 bg-white p-6 text-center shadow-lg transition-shadow hover:shadow-xl sm:w-1/2 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-gray-300">
            Create a New Room
          </h3>
          <div>
            <DoorClosed className="m-[5px] size-14 stroke-black dark:stroke-white" />
          </div>
          <p className="mb-6 text-sm text-gray-600 dark:text-gray-100">
            Start a new room and invite others to join you.
          </p>
          <button
            onClick={onCreateRoom}
            disabled={disabled}
            className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:text-zinc-950 dark:hover:bg-violet-600"
          >
            {pending ? "Please wait…" : "Create Room"}
          </button>
        </div>

        <div className="flex w-full flex-col items-center rounded-lg border border-gray-200 bg-white p-6 text-center shadow-lg transition-shadow hover:shadow-xl sm:w-1/2 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-300">
            Join an Existing Room
          </h3>
          <p className="mb-6 text-sm text-gray-600 dark:text-gray-100">
            Enter a Room ID to join an existing session.
          </p>
          <form
            onSubmit={handleJoinSubmit}
            className="flex w-full flex-col gap-4"
          >
            <input
              id="room-code"
              aria-label="Room code"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              disabled={disabled}
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.replace(/\D/g, ""))}
              placeholder="Enter Room ID"
              className="min-h-11 w-full rounded-lg border border-gray-300 px-4 py-2 transition focus:border-green-400 focus:ring-2 focus:ring-green-400 focus:outline-hidden dark:border-neutral-700 dark:bg-zinc-950 dark:text-white dark:placeholder-neutral-400 dark:focus:border-orange-200 dark:focus:ring-orange-400"
              maxLength={5}
            />
            <button
              type="submit"
              disabled={disabled}
              className="rounded-lg bg-green-700 px-6 py-3 font-medium text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-400 dark:text-zinc-950 dark:hover:bg-orange-500"
            >
              {pending ? "Please wait…" : "Join Room"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
