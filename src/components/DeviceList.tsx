import React from "react";
import { Device } from "../types/types";

interface DeviceListProps {
  devices: Device[];
  selectedDevice: Device | null;
  onDeviceSelect: (device: Device) => void;
  peerStatuses?: Record<string, string>;
}

export const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  selectedDevice,
  onDeviceSelect,
  peerStatuses = {},
}) => {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {devices.map((device) => (
        <button
          key={device.id}
          onClick={() => onDeviceSelect(device)}
          disabled={device.online === false}
          aria-pressed={selectedDevice?.id === device.id}
          className={`min-w-0 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            selectedDevice?.id === device.id
              ? "border-blue-500 bg-blue-50 hover:border-blue-700 dark:border-violet-500 dark:bg-neutral-900 dark:hover:border-violet-700"
              : "border-gray-400 bg-white hover:border-blue-400 dark:bg-zinc-800 dark:hover:border-violet-400"
          }`}
        >
          <div className="truncate font-medium text-gray-900 dark:text-gray-300">
            {device.name}
          </div>
          <div className="truncate text-sm text-gray-500 dark:text-gray-300">
            {device.type}
          </div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {device.online === false
              ? "Reconnecting…"
              : peerStatuses[device.id] === "connected"
                ? "Connected"
                : peerStatuses[device.id] === "failed"
                  ? "Ready to retry"
                  : ["connecting", "reconnecting"].includes(
                        peerStatuses[device.id],
                      )
                    ? "Connecting…"
                    : "Available"}
          </div>
        </button>
      ))}
    </div>
  );
};
