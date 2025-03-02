/* eslint-disable @typescript-eslint/no-explicit-any */
import { FileTransfer, FileTransferError } from "../types/types";

export class WebRTCHandler {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private ws: WebSocket;
  private pendingChunks: Map<string, number> = new Map();
  private config: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "4f4af8ccdd1b0b8c3b09d1d3",
        credential: "nXgI5UFhuW+pOm6e",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "4f4af8ccdd1b0b8c3b09d1d3",
        credential: "nXgI5UFhuW+pOm6e",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "4f4af8ccdd1b0b8c3b09d1d3",
        credential: "nXgI5UFhuW+pOm6e",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "4f4af8ccdd1b0b8c3b09d1d3",
        credential: "nXgI5UFhuW+pOm6e",
      },
    ],
    iceCandidatePoolSize: 10,
  };

  // File transfer state
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

  // Callbacks
  private callbacks: {
    onTransferProgress: (transfer: FileTransfer) => void;
    onTransferComplete: (transfer: FileTransfer) => void;
    onTransferError: (transfer: FileTransferError, error: string) => void;
    onFileReceived: (fileName: string, fileData: Blob) => void;
  };

  // Constants for file transfer
  private static CHUNK_SIZE = 16384; // 16KB chunks for better performance

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

    // Setup WebSocket message handler for signaling
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

    return peerConnection;
  }

  private setupDataChannel(dataChannel: RTCDataChannel, peerId: string) {
    this.dataChannels.set(peerId, dataChannel);

    dataChannel.binaryType = "arraybuffer";

    dataChannel.onopen = () => {
      console.log(`Data channel with ${peerId} is now open`);
    };

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
    // Handle different types of messages
    if (typeof event.data === "string") {
      // Text message - control messages
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "file-info":
          this.handleFileInfo(data, peerId);
          break;
        case "file-chunk":
          // This is just the metadata about the chunk, the binary data comes separately
          this.prepareForChunk(data);
          break;
        case "transfer-complete":
          this.finalizeFileTransfer(data.transferId);
          break;
      }
    } else {
      // Binary data - actual file chunks
      this.processFileChunk(event.data);
    }
  }

  private prepareForChunk(data: any) {
    const { transferId, chunkIndex } = data;

    // Store metadata about the expected next chunk
    if (!this.pendingChunks) {
      this.pendingChunks = new Map();
    }

    // Store which chunk we're expecting next for this transfer
    this.pendingChunks.set(transferId, chunkIndex);
  }

  private processFileChunk(data: ArrayBuffer) {
    // Find which transfer this chunk belongs to
    const pendingEntry = Array.from(this.pendingChunks.entries())[0];

    if (!pendingEntry) {
      console.error("Received chunk but no pending transfer");
      return;
    }

    const [transferId, chunkIndex] = pendingEntry;
    const info = this.fileInfo.get(transferId);

    if (!info) {
      console.error("No file info for transfer", transferId);
      return;
    }

    // Store chunk with explicit index
    const chunks = this.fileChunks.get(transferId) || new Map();
    chunks.set(chunkIndex, new Uint8Array(data));
    this.fileChunks.set(transferId, chunks);

    // Update count and remove from pending
    info.receivedChunks++;
    this.fileInfo.set(transferId, info);
    this.pendingChunks.delete(transferId);

    // Send acknowledgment periodically
    const shouldAck =
      info.totalChunks < 50 ||
      info.receivedChunks % 5 === 0 ||
      info.receivedChunks === info.totalChunks;

    if (shouldAck) {
      // Send acknowledgment for flow control
      for (const [, channel] of this.dataChannels.entries()) {
        if (channel.readyState === "open") {
          try {
            channel.send(
              JSON.stringify({
                type: "chunk-ack",
                transferId,
                receivedCount: info.receivedChunks,
              }),
            );
            break; // Send to first open channel
          } catch (err) {
            console.error("Error sending acknowledgment:", err);
          }
        }
      }
    }

    // Update progress but limit UI updates
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

    // Check if all chunks received
    if (info.receivedChunks === info.totalChunks) {
      this.finalizeFileTransfer(transferId);
    }
  }

  private handleFileInfo(data: any, peerId: string) {
    const { transferId, fileName, fileSize, totalChunks } = data;

    // Initialize file info for the incoming transfer
    this.fileInfo.set(transferId, {
      fileName,
      fileSize,
      totalChunks,
      receivedChunks: 0,
    });

    // Initialize storage for chunks
    this.fileChunks.set(transferId, new Map());

    // Acknowledge that we're ready to receive
    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel) {
      dataChannel.send(
        JSON.stringify({
          type: "file-info-ack",
          transferId,
        }),
      );
    }

    // Create an entry in the transfers list
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

    // Check if we have all expected chunks
    if (info.receivedChunks < info.totalChunks) {
      this.callbacks.onTransferError(
        { id: transferId, fileName: info.fileName },
        `Transfer incomplete: missing ${info.totalChunks - info.receivedChunks} chunks`,
      );
      return;
    }

    // Assemble the file from chunks
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

    // Create final file blob with proper MIME type detection
    const fileExt = info.fileName.split(".").pop()?.toLowerCase() || "";
    let mimeType = "application/octet-stream";

    // Set proper MIME type for common video formats
    if (["mp4", "mpeg", "mpg"].includes(fileExt)) mimeType = "video/mp4";
    if (["webm"].includes(fileExt)) mimeType = "video/webm";
    if (["mov", "qt"].includes(fileExt)) mimeType = "video/quicktime";
    if (["avi"].includes(fileExt)) mimeType = "video/x-msvideo";

    const fileBlob = new Blob(orderedChunks, { type: mimeType });

    // Notify completion
    this.callbacks.onTransferComplete({
      id: transferId,
      fileName: info.fileName,
      fileSize: info.fileSize,
      progress: 100,
      status: "completed",
    });

    // Send file to the callback for download
    this.callbacks.onFileReceived(info.fileName, fileBlob);

    // Clean up
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

  public async sendFile(file: File, targetId: string) {
    // Generate a unique ID for this transfer
    const transferId = this.generateUUID();

    // Ensure we have a data channel
    let dataChannel = this.dataChannels.get(targetId);

    if (!dataChannel || dataChannel.readyState !== "open") {
      // Create a new peer connection if needed
      const peerConnection = await this.createPeerConnection(targetId);

      // Create data channel with ordered delivery
      dataChannel = peerConnection.createDataChannel(
        `file-transfer-${transferId}`,
        {
          ordered: true,
        },
      );
      this.setupDataChannel(dataChannel, targetId);

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.ws.send(
        JSON.stringify({
          type: "rtc-offer",
          to: targetId,
          sdp: offer.sdp,
        }),
      );

      // Wait for data channel to open with timeout
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

    // Calculate total chunks
    const totalChunks = Math.ceil(file.size / WebRTCHandler.CHUNK_SIZE);

    // Send file info and wait for acknowledgment
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
      // Track progress
      let sentChunks = 0;
      const updateProgress = () => {
        const progress = Math.round((sentChunks / totalChunks) * 100);
        this.callbacks.onTransferProgress({
          id: transferId,
          fileName: file.name,
          fileSize: file.size,
          progress,
          status: "transferring",
        });
      };

      // Send file in chunks with better background tab support
      const sendChunk = async (index: number) => {
        const start = index * WebRTCHandler.CHUNK_SIZE;
        const end = Math.min(start + WebRTCHandler.CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const buffer = await chunk.arrayBuffer();

        // Check buffer state and wait if necessary
        while (dataChannel.bufferedAmount > 8 * 1024 * 1024) {
          // Use shorter intervals to recover faster when tab becomes active again
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
        sentChunks++;

        // Update progress periodically
        if (sentChunks % 5 === 0 || sentChunks === totalChunks) {
          updateProgress();
        }
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

      // Completion code remains the same
      updateProgress();
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
    } catch (error) {
      // Error handling remains the same
      console.error("Error during file transfer:", error);
      this.callbacks.onTransferError(
        { id: transferId, fileName: file.name },
        error instanceof Error
          ? error.message
          : "Unknown error during transfer",
      );
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

    // Remove event listeners
    this.ws.removeEventListener("message", this.handleSignalingMessage);
  }
}
