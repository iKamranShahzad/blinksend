import React from "react";
import { Device } from "../types/types";

interface DeviceListProps {
  devices: Device[];
  selectedDevice: Device | null;
  onDeviceSelect: (device: Device) => void;
}

export const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  selectedDevice,
  onDeviceSelect,
}) => {
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
