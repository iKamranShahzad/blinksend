export interface Device {
  id: string;
  name: string;
  type: string;
}

export interface FileTransfer {
  id: string;

  fileName: string;

  fileSize: number;

  progress: number;

  status: "pending" | "transferring" | "receiving" | "completed" | "error";
}

// src/types/types.ts

export interface FileTransferReceiver {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: Map<number, Uint8Array>;
  receivedCount: number;
}
