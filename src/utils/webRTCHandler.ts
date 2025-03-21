/* eslint-disable @typescript-eslint/no-explicit-any */
import { FileTransfer, FileTransferError } from "../types/types";

export class WebRTCHandler {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private ws: WebSocket;
  private pendingChunks: Map<string, { peerId: string; chunkIndex: number }> =
    new Map();

  private config: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: process.env.NEXT_PUBLIC_TURN_SERVER_URL || "",
        username: process.env.NEXT_PUBLIC_TURN_SERVER_USERNAME || "",
        credential: process.env.NEXT_PUBLIC_TURN_SERVER_CREDENTIAL || "",
      },
    ],
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 10,
  };

  private fileChunks: Map<string, Map<number, Uint8Array>> = new Map();
  private fileInfo: Map<
    string,
    {
      fileName: string;
      fileSize: number;
      totalChunks: number;
      receivedChunks: number;
    }
  > = new Map();
  private sendingTransfers: Map<
    string,
    { targetId: string; fileName: string }
  > = new Map();

  private callbacks: {
    onTransferProgress: (transfer: FileTransfer) => void;
    onTransferComplete: (transfer: FileTransfer) => void;
    onTransferError: (transfer: FileTransferError, error: string) => void;
    onFileReceived: (fileName: string, fileData: Blob) => void;
  };

  private static CHUNK_SIZE = 16384;

  constructor(
    ws: WebSocket,
    callbacks: {
      onTransferProgress: (transfer: FileTransfer) => void;
      onTransferComplete: (transfer: FileTransfer) => void;
      onTransferError: (transfer: FileTransferError, error: string) => void;
      onFileReceived: (fileName: string, fileData: Blob) => void;
    },
  ) {
    this.ws = ws;
    this.callbacks = callbacks;

    this.ws.addEventListener("message", this.handleSignalingMessage);
  }

  private handleSignalingMessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case "rtc-offer":
        this.handleOffer(data);
        break;
      case "rtc-answer":
        this.handleAnswer(data);
        break;
      case "rtc-candidate":
        this.handleCandidate(data);
        break;
    }
  };

  private async createPeerConnection(targetId: string) {
    if (this.peerConnections.has(targetId)) {
      return this.peerConnections.get(targetId)!;
    }

    const peerConnection = new RTCPeerConnection(this.config);
    this.peerConnections.set(targetId, peerConnection);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send(
          JSON.stringify({
            type: "rtc-candidate",
            to: targetId,
            candidate: event.candidate,
          }),
        );
      }
    };

    peerConnection.ondatachannel = (event) => {
      const dataChannel = event.channel;
      this.setupDataChannel(dataChannel, targetId);
    };

    this.setupConnectionStateMonitoring(peerConnection, targetId);

    return peerConnection;
  }

  private setupConnectionStateMonitoring(
    peerConnection: RTCPeerConnection,
    peerId: string,
  ) {
    peerConnection.addEventListener("iceconnectionstatechange", () => {
      const state = peerConnection.iceConnectionState;

      if (
        state === "disconnected" ||
        state === "failed" ||
        state === "closed"
      ) {
        this.dataChannels.forEach((channel, id) => {
          if (id === peerId) {
            this.fileInfo.forEach((info, transferId) => {
              if (info.receivedChunks < info.totalChunks) {
                this.callbacks.onTransferError(
                  { id: transferId, fileName: info.fileName },
                  `Connection lost: Peer disconnected (${state})`,
                );
              }
            });

            this.sendingTransfers.forEach((transfer, transferId) => {
              if (transfer.targetId === peerId) {
                this.callbacks.onTransferError(
                  { id: transferId, fileName: transfer.fileName },
                  `Connection lost: Receiver disconnected (${state})`,
                );
                this.sendingTransfers.delete(transferId);
              }
            });
          }
        });
      }
    });
  }

  private setupDataChannel(dataChannel: RTCDataChannel, peerId: string) {
    this.dataChannels.set(peerId, dataChannel);

    dataChannel.binaryType = "arraybuffer";

    dataChannel.onopen = () => {
      console.log(`Data channel with ${peerId} is now open`);
    };

    dataChannel.addEventListener("close", () => {
      const transfersInProgress = new Map<string, { fileName: string }>();

      this.fileInfo.forEach((info, transferId) => {
        if (info.receivedChunks < info.totalChunks) {
          transfersInProgress.set(transferId, { fileName: info.fileName });
        }
      });

      transfersInProgress.forEach(({ fileName }, transferId) => {
        this.callbacks.onTransferError(
          { id: transferId, fileName },
          "Connection closed unexpectedly",
        );
      });

      this.sendingTransfers.forEach((transfer, transferId) => {
        if (transfer.targetId === peerId) {
          this.callbacks.onTransferError(
            { id: transferId, fileName: transfer.fileName },
            "Receiver disconnected unexpectedly",
          );
          this.sendingTransfers.delete(transferId);
        }
      });
    });

    dataChannel.onclose = () => {
      console.log(`Data channel with ${peerId} is now closed`);
    };

    dataChannel.onerror = (error) => {
      console.error(`Data channel error with ${peerId}:`, error);
    };

    dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event, peerId);
    };
  }

  private async handleOffer(data: any) {
    const fromId = data.from;
    const peerConnection = await this.createPeerConnection(fromId);

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription({
        type: "offer",
        sdp: data.sdp,
      }),
    );

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    this.ws.send(
      JSON.stringify({
        type: "rtc-answer",
        to: fromId,
        sdp: answer.sdp,
      }),
    );
  }

  private async handleAnswer(data: any) {
    const fromId = data.from;
    const peerConnection = this.peerConnections.get(fromId);

    if (peerConnection) {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription({
          type: "answer",
          sdp: data.sdp,
        }),
      );
    }
  }

  private async handleCandidate(data: any) {
    const fromId = data.from;
    const peerConnection = this.peerConnections.get(fromId);

    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  }

  private handleDataChannelMessage(event: MessageEvent, peerId: string) {
    if (typeof event.data === "string") {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "file-info":
          this.handleFileInfo(data, peerId);
          break;
        case "file-chunk":
          this.prepareForChunk(data, peerId);
          break;
        case "transfer-complete":
          this.finalizeFileTransfer(data.transferId);
          break;
      }
    } else {
      this.processFileChunk(event.data, peerId);
    }
  }

  private prepareForChunk(data: any, peerId: string) {
    const { transferId, chunkIndex } = data;

    if (!this.pendingChunks) {
      this.pendingChunks = new Map();
    }

    this.pendingChunks.set(transferId, {
      peerId,
      chunkIndex,
    });
  }

  private processFileChunk(data: ArrayBuffer, peerId: string) {
    const pendingEntry = Array.from(this.pendingChunks.entries()).find(
      ([, info]) => info.peerId === peerId,
    );

    if (!pendingEntry) {
      console.error("Received chunk but no pending transfer for peer", peerId);
      return;
    }

    const [transferId, chunkInfo] = pendingEntry;
    const chunkIndex = chunkInfo.chunkIndex;
    const info = this.fileInfo.get(transferId);

    if (!info) {
      console.error("No file info for transfer", transferId);
      return;
    }

    const chunks = this.fileChunks.get(transferId) || new Map();
    chunks.set(chunkIndex, new Uint8Array(data));
    this.fileChunks.set(transferId, chunks);

    info.receivedChunks++;
    this.fileInfo.set(transferId, info);
    this.pendingChunks.delete(transferId);

    const shouldAck =
      info.totalChunks < 50 ||
      info.receivedChunks % 5 === 0 ||
      info.receivedChunks === info.totalChunks;

    if (shouldAck) {
      const dataChannel = this.dataChannels.get(peerId);
      if (dataChannel && dataChannel.readyState === "open") {
        try {
          dataChannel.send(
            JSON.stringify({
              type: "chunk-ack",
              transferId,
              receivedCount: info.receivedChunks,
            }),
          );
        } catch (err) {
          console.error("Error sending acknowledgment:", err);
        }
      }
    }

    if (shouldAck || info.receivedChunks === info.totalChunks) {
      const progress = Math.round(
        (info.receivedChunks / info.totalChunks) * 100,
      );
      this.callbacks.onTransferProgress({
        id: transferId,
        fileName: info.fileName,
        fileSize: info.fileSize,
        progress,
        status: "receiving",
      });
    }

    if (info.receivedChunks === info.totalChunks) {
      this.finalizeFileTransfer(transferId);
    }
  }

  private handleFileInfo(data: any, peerId: string) {
    const { transferId, fileName, fileSize, totalChunks } = data;

    this.fileInfo.set(transferId, {
      fileName,
      fileSize,
      totalChunks,
      receivedChunks: 0,
    });

    this.fileChunks.set(transferId, new Map());

    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel) {
      dataChannel.send(
        JSON.stringify({
          type: "file-info-ack",
          transferId,
        }),
      );
    }

    this.callbacks.onTransferProgress({
      id: transferId,
      fileName,
      fileSize,
      progress: 0,
      status: "receiving",
    });
  }

  private finalizeFileTransfer(transferId: string) {
    const info = this.fileInfo.get(transferId);
    const chunks = this.fileChunks.get(transferId);

    if (!info || !chunks) {
      return;
    }

    if (info.receivedChunks < info.totalChunks) {
      this.callbacks.onTransferError(
        { id: transferId, fileName: info.fileName },
        `Transfer incomplete: missing ${info.totalChunks - info.receivedChunks} chunks`,
      );
      return;
    }

    const orderedChunks: Uint8Array[] = [];
    let hasError = false;

    for (let i = 0; i < info.totalChunks; i++) {
      const chunk = chunks.get(i);
      if (!chunk) {
        this.callbacks.onTransferError(
          { id: transferId, fileName: info.fileName },
          `Missing chunk ${i} of ${info.totalChunks}`,
        );
        hasError = true;
        break;
      }
      orderedChunks.push(chunk);
    }

    if (hasError) {
      return;
    }

    const fileExt = info.fileName.split(".").pop()?.toLowerCase() || "";
    let mimeType = "application/octet-stream";

    // Setting proper MIME type for common video formats
    if (["mp4", "mpeg", "mpg"].includes(fileExt)) mimeType = "video/mp4";
    if (["webm"].includes(fileExt)) mimeType = "video/webm";
    if (["mov", "qt"].includes(fileExt)) mimeType = "video/quicktime";
    if (["avi"].includes(fileExt)) mimeType = "video/x-msvideo";

    const fileBlob = new Blob(orderedChunks, { type: mimeType });

    this.callbacks.onTransferComplete({
      id: transferId,
      fileName: info.fileName,
      fileSize: info.fileSize,
      progress: 100,
      status: "completed",
    });

    this.callbacks.onFileReceived(info.fileName, fileBlob);

    this.fileInfo.delete(transferId);
    this.fileChunks.delete(transferId);
  }

  private generateUUID(): string {
    if ("randomUUID" in crypto) {
      return crypto.randomUUID();
    } else {
      // RFC4122 version 4 compliant UUID fallback
      return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (
          +c ^
          (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
        ).toString(16),
      );
    }
  }

  public async sendFile(
    file: File,
    targetId: string,
    existingTransferId?: string,
  ) {
    const transferId = existingTransferId || this.generateUUID();

    const transferTimeout = setTimeout(() => {
      const transfer = this.fileInfo.get(transferId);
      if (transfer && transfer.receivedChunks < transfer.totalChunks) {
        this.callbacks.onTransferError(
          { id: transferId, fileName: file.name },
          "Transfer timed out - no progress",
        );
      }
    }, 30000);

    this.sendingTransfers.set(transferId, {
      targetId,
      fileName: file.name,
    });

    let dataChannel = this.dataChannels.get(targetId);

    if (!dataChannel || dataChannel.readyState !== "open") {
      const peerConnection = await this.createPeerConnection(targetId);

      dataChannel = peerConnection.createDataChannel(
        `file-transfer-${transferId}`,
        {
          ordered: true,
        },
      );
      this.setupDataChannel(dataChannel, targetId);

      // Creating and sending offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.ws.send(
        JSON.stringify({
          type: "rtc-offer",
          to: targetId,
          sdp: offer.sdp,
        }),
      );

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for data channel to open"));
        }, 15000); // 15s timeout

        const checkState = () => {
          if (dataChannel?.readyState === "open") {
            clearTimeout(timeout);
            resolve();
          } else if (
            dataChannel?.readyState === "closed" ||
            dataChannel?.readyState === "closing"
          ) {
            clearTimeout(timeout);
            reject(
              new Error("Data channel closed before transfer could start"),
            );
          } else {
            setTimeout(checkState, 100);
          }
        };
        checkState();
      });
    }

    // Start transfer process
    this.callbacks.onTransferProgress({
      id: transferId,
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      status: "pending",
    });

    // Calculating total chunks
    const totalChunks = Math.ceil(file.size / WebRTCHandler.CHUNK_SIZE);

    dataChannel.send(
      JSON.stringify({
        type: "file-info",
        transferId,
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
      }),
    );

    // Wait for acknowledgment with timeout
    await new Promise<void>((resolve) => {
      const messageHandler = (event: MessageEvent) => {
        if (typeof event.data === "string") {
          try {
            const data = JSON.parse(event.data);
            if (
              data.type === "file-info-ack" &&
              data.transferId === transferId
            ) {
              dataChannel?.removeEventListener("message", messageHandler);
              resolve();
            }
          } catch {
            // Not JSON, ignore
          }
        }
      };

      dataChannel.addEventListener("message", messageHandler);

      setTimeout(() => {
        dataChannel?.removeEventListener("message", messageHandler);
        resolve(); // Continue anyway after timeout
      }, 5000);
    });

    try {
      // Tracking progress based on receiver acknowledgments
      let acknowledgedChunks = 0;

      const updateProgress = () => {
        const progress = Math.round((acknowledgedChunks / totalChunks) * 100);
        this.callbacks.onTransferProgress({
          id: transferId,
          fileName: file.name,
          fileSize: file.size,
          progress,
          status: "transferring",
        });
      };

      // Listen for acknowledgments from the receiver
      const acknowledgmentHandler = (event: MessageEvent) => {
        if (typeof event.data === "string") {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "chunk-ack" && data.transferId === transferId) {
              acknowledgedChunks = data.receivedCount;
              updateProgress();
            }
          } catch {
            // Not JSON, ignore
          }
        }
      };

      dataChannel.addEventListener("message", acknowledgmentHandler);

      // Send file in chunks with better background tab support
      const sendChunk = async (index: number) => {
        const start = index * WebRTCHandler.CHUNK_SIZE;
        const end = Math.min(start + WebRTCHandler.CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const buffer = await chunk.arrayBuffer();

        // Check buffer state and wait if necessary
        while (dataChannel.bufferedAmount > 8 * 1024 * 1024) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Send chunk metadata
        dataChannel.send(
          JSON.stringify({
            type: "file-chunk",
            transferId,
            chunkIndex: index,
          }),
        );

        // Send binary data immediately after metadata
        dataChannel.send(buffer);
      };

      // Process chunks in batches for better performance
      const BATCH_SIZE = 10;
      for (let i = 0; i < totalChunks; i += BATCH_SIZE) {
        const batch = [];
        for (let j = 0; j < BATCH_SIZE && i + j < totalChunks; j++) {
          batch.push(sendChunk(i + j));
        }

        // Wait for batch to complete
        await Promise.all(batch);

        // Small yield to allow UI updates
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      this.sendingTransfers.delete(transferId);

      // Wait for all chunks to be acknowledged before marking as completed
      await new Promise<void>((resolve) => {
        const acknowledgmentCheckInterval = setInterval(() => {
          if (acknowledgedChunks === totalChunks) {
            clearInterval(acknowledgmentCheckInterval);
            resolve();
          }
        }, 100); // Check every 100ms
      });

      // Send "transfer-complete" message after all chunks are acknowledged
      dataChannel.send(
        JSON.stringify({
          type: "transfer-complete",
          transferId,
        }),
      );

      this.callbacks.onTransferComplete({
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        progress: 100,
        status: "completed",
      });

      clearTimeout(transferTimeout);
      dataChannel.removeEventListener("message", acknowledgmentHandler);
    } catch (error) {
      console.error("Error during file transfer:", error);
      this.sendingTransfers.delete(transferId);
      this.callbacks.onTransferError(
        { id: transferId, fileName: file.name },
        error instanceof Error
          ? error.message
          : "Unknown error during transfer",
      );
      clearTimeout(transferTimeout);
    }
  }

  public cleanup() {
    // Close all data channels
    this.dataChannels.forEach((channel) => {
      channel.close();
    });

    // Close all peer connections
    this.peerConnections.forEach((connection) => {
      connection.close();
    });

    // Clear all maps
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.fileChunks.clear();
    this.fileInfo.clear();
    this.sendingTransfers.clear();

    // Remove event listeners
    this.ws.removeEventListener("message", this.handleSignalingMessage);
  }
}
