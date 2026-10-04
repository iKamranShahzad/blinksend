export interface Device {
  id: string;
  name: string;
  type: string;
  online?: boolean;
}

export interface FileTransfer {
  id: string;

  fileName: string;

  fileSize: number;

  progress: number;

  status:
    | "pending"
    | "transferring"
    | "receiving"
    | "completed"
    | "error"
    | "finalizing"
    | "queued"
    | "paused"
    | "cancelled";
  direction?: "send" | "receive";
  peerId?: string;
  peerName?: string;
  transferredBytes?: number;
  bytesPerSecond?: number;
  remainingSeconds?: number;
  error?: string;
}

export type ConnectionStatus =
  "connecting" | "connected" | "reconnecting" | "offline" | "error";

export interface SignalMessage {
  type: string;
  id?: string;
  name?: string;
  roomId?: string | null;
  resumeToken?: string;
  protocolVersion?: number;
  devices?: Device[];
  from?: string;
  to?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  code?: string;
  message?: string;
  requestType?: string;
  deviceName?: string;
}

export interface FileTransferError {
  id: string;
  fileName: string;
}

export interface FileTransferReceiver {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: Map<number, Uint8Array>;
  receivedCount: number;
}
