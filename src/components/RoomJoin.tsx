import React, { useState } from "react";

interface RoomJoinProps {
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
}

export const RoomJoin: React.FC<RoomJoinProps> = ({
  onCreateRoom,
  onJoinRoom,
}) => {
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState("");

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.length !== 5) {
      setError("Room ID must be 5 digits");
      return;
    }
    setError("");
    onJoinRoom(roomId);
  };

  return (
    <div className="flex flex-col items-center justify-center gap-8 p-6 sm:flex-row">
      <div className="flex w-full flex-col items-center rounded-lg border border-gray-200 bg-white p-6 text-center shadow-lg transition-shadow hover:shadow-xl sm:w-1/2">
        <h3 className="mb-4 text-lg font-semibold text-gray-800">
          Create a New Room
        </h3>
        <p className="mb-6 text-sm text-gray-600">
          Start a new room and invite others to join you.
        </p>
        <button
          onClick={onCreateRoom}
          className="rounded-lg bg-blue-500 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-600"
        >
          Create Room
        </button>
      </div>

      <div className="flex w-full flex-col items-center rounded-lg border border-gray-200 bg-white p-6 text-center shadow-lg transition-shadow hover:shadow-xl sm:w-1/2">
        <h3 className="mb-4 text-lg font-semibold text-gray-800">
          Join an Existing Room
        </h3>
        <p className="mb-6 text-sm text-gray-600">
          Enter a Room ID to join an existing session.
        </p>
        <form
          onSubmit={handleJoinSubmit}
          className="flex w-full flex-col gap-4"
        >
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Enter Room ID"
            className="w-full rounded-lg border border-gray-300 px-4 py-2 transition focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400"
            maxLength={5}
          />
          <button
            type="submit"
            className="rounded-lg bg-green-500 px-6 py-3 font-medium text-white transition-colors hover:bg-green-600"
          >
            Join Room
          </button>
        </form>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-4 w-full rounded-lg border border-red-200 bg-red-100 p-3 text-center text-red-600 sm:w-1/2">
          {error}
        </div>
      )}
    </div>
  );
};
