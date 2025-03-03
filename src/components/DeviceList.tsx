import React from "react";
import { Device } from "../types/types";

interface DeviceListProps {
  devices: Device[];
  selectedDevice: Device | null;
  onDeviceSelect: (device: Device) => void;
  roomId: string | null;
}

export const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  selectedDevice,
  onDeviceSelect,
  roomId,
}) => {
  if (devices.length === 0) {
    return (
      <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-6 text-center shadow-sm dark:border-indigo-800 dark:from-indigo-900/40 dark:to-violet-900/20">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-indigo-800/60">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-blue-600 dark:text-indigo-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m-8 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        </div>

        <h3 className="mb-2 text-lg font-medium text-blue-800 dark:text-indigo-200">
          Ready to Share
        </h3>

        <div className="mx-auto mb-2 max-w-xs rounded-lg bg-white/80 px-4 py-2 font-mono text-lg font-bold tracking-wider text-blue-800 shadow-sm dark:bg-indigo-900/60 dark:text-indigo-100">
          {roomId || "..."}
        </div>

        <p className="text-sm text-blue-600 dark:text-indigo-400">
          Share this code to connect devices
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {devices.map((device) => (
        <button
          key={device.id}
          onClick={() => onDeviceSelect(device)}
          className={`rounded-lg border p-4 text-left transition-colors ${
            selectedDevice?.id === device.id
              ? "border-blue-500 bg-blue-50 hover:border-blue-700 dark:border-violet-500 dark:bg-neutral-900 dark:hover:border-violet-700"
              : "border-gray-400 bg-white hover:border-blue-400 dark:bg-zinc-800 dark:hover:border-violet-400"
          }`}
        >
          <div className="font-medium text-gray-900 dark:text-gray-300">
            {device.name}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-100">
            {device.type}
          </div>
        </button>
      ))}
    </div>
  );
};
