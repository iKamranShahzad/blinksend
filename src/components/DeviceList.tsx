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
              ? "border-blue-500 bg-blue-50"
              : "border-gray-200 hover:border-blue-200"
          }`}
        >
          <div className="font-medium text-gray-900">{device.name}</div>
          <div className="text-sm text-gray-500">{device.type}</div>
        </button>
      ))}
    </div>
  );
};
