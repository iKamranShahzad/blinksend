/* eslint-disable @typescript-eslint/no-explicit-any */
import { FileTransfer, FileTransferError } from "../types/types";

export class WebRTCHandler {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private ws: WebSocket;
  private config: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      // Add TURN servers - you'll need credentials for a production TURN server
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

    // Add connection state monitoring
    peerConnection.onconnectionstatechange = () => {
      console.log(
        `Connection state changed: ${peerConnection.connectionState}`,
      );
      if (peerConnection.connectionState === "failed") {
        console.error(
          "Connection failed, possibly due to NAT traversal issues",
        );
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state: ${peerConnection.iceConnectionState}`);
      if (peerConnection.iceConnectionState === "failed") {
        // Try to restart ICE
        peerConnection.restartIce();
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
    const { transferId } = data;

    // Make sure we have a place to store this chunk
    if (!this.fileChunks.has(transferId)) {
      this.fileChunks.set(transferId, new Map());
    }
  }

  private processFileChunk(data: ArrayBuffer) {
    // The last non-binary message should have been a file-chunk message
    // indicating which transfer and chunk this belongs to
    const fileInfo = Array.from(this.fileInfo.entries()).find(
      ([, info]) => info.receivedChunks < info.totalChunks,
    );

    if (!fileInfo) {
      console.error("Received file chunk but no active transfer");
      return;
    }

    const [transferId, info] = fileInfo;
    const chunkIndex = info.receivedChunks;

    // Store the chunk
    const chunks = this.fileChunks.get(transferId) || new Map();
    chunks.set(chunkIndex, new Uint8Array(data));
    this.fileChunks.set(transferId, chunks);

    // Update received count
    info.receivedChunks++;
    this.fileInfo.set(transferId, info);

    // Send an acknowledgment every 5 chunks or for every chunk for small files
    const shouldAck =
      info.totalChunks < 50 ||
      info.receivedChunks % 5 === 0 ||
      info.receivedChunks === info.totalChunks;

    if (shouldAck) {
      // Send acknowledgment to help with flow control
      for (const [peerId, channel] of this.dataChannels.entries()) {
        if (channel.readyState === "open") {
          try {
            channel.send(
              JSON.stringify({
                type: "chunk-ack",
                transferId,
                receivedCount: info.receivedChunks,
              }),
            );
            break; // Send to the first open channel
          } catch (err) {
            console.error("Error sending chunk acknowledgment:", err);
          }
        }
      }
    }

    // Update progress but don't spam UI updates
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

    // Assemble the file from chunks
    const orderedChunks: Uint8Array[] = [];
    for (let i = 0; i < info.totalChunks; i++) {
      const chunk = chunks.get(i);
      if (!chunk) {
        this.callbacks.onTransferError(
          { id: transferId, fileName: info.fileName },
          `Missing chunk ${i}`,
        );
        return;
      }
      orderedChunks.push(chunk);
    }

    // Create final file blob
    const fileBlob = new Blob(orderedChunks);

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

  public async sendFile(file: File, targetId: string) {
    // Generate a unique ID for this transfer
    const transferId = crypto.randomUUID();

    // Ensure we have a data channel for this peer
    let dataChannel = this.dataChannels.get(targetId);

    if (!dataChannel || dataChannel.readyState !== "open") {
      // Create a new peer connection if needed
      const peerConnection = await this.createPeerConnection(targetId);

      // Create a new data channel for file transfer
      dataChannel = peerConnection.createDataChannel(
        `file-transfer-${transferId}`,
        {
          ordered: true,
        },
      );
      this.setupDataChannel(dataChannel, targetId);

      // Create and send the offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.ws.send(
        JSON.stringify({
          type: "rtc-offer",
          to: targetId,
          sdp: offer.sdp,
        }),
      );

      // Wait for data channel to open
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for data channel to open"));
        }, 15000); // 15s timeout for connection establishment

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

    // Notify UI about the transfer
    this.callbacks.onTransferProgress({
      id: transferId,
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      status: "pending",
    });

    // Calculate total chunks
    const totalChunks = Math.ceil(file.size / WebRTCHandler.CHUNK_SIZE);

    // Send file info first
    dataChannel.send(
      JSON.stringify({
        type: "file-info",
        transferId,
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
      }),
    );

    // Wait for acknowledgment
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

      // Timeout after 5 seconds
      setTimeout(() => {
        dataChannel?.removeEventListener("message", messageHandler);
        resolve(); // Continue anyway
      }, 5000);
    });

    // Set up progress tracking
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

    try {
      // Start sending file in chunks with flow control
      for (let i = 0; i < totalChunks; i++) {
        const start = i * WebRTCHandler.CHUNK_SIZE;
        const end = Math.min(start + WebRTCHandler.CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const buffer = await chunk.arrayBuffer();

        // Check buffer state and wait if necessary
        if (dataChannel.bufferedAmount > 8 * 1024 * 1024) {
          // 8MB buffer threshold
          await new Promise<void>((resolve) => {
            const checkBuffer = () => {
              if (dataChannel.bufferedAmount < 1 * 1024 * 1024) {
                // Wait until it drops below 1MB
                resolve();
              } else {
                setTimeout(checkBuffer, 100);
              }
            };
            setTimeout(checkBuffer, 100);
          });
        }

        // Send chunk metadata
        dataChannel.send(
          JSON.stringify({
            type: "file-chunk",
            transferId,
            chunkIndex: i,
          }),
        );

        // Wait a tiny bit to ensure metadata is processed first
        await new Promise((resolve) => setTimeout(resolve, 5));

        // Send binary data
        dataChannel.send(buffer);
        sentChunks++;

        // Update progress periodically (not every chunk)
        if (sentChunks % 5 === 0 || sentChunks === totalChunks) {
          updateProgress();
        }

        // Allow the browser to catch up periodically
        if (i % 20 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Final progress update
      updateProgress();

      // Signal completion
      dataChannel.send(
        JSON.stringify({
          type: "transfer-complete",
          transferId,
        }),
      );

      // Mark transfer as complete
      this.callbacks.onTransferComplete({
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        progress: 100,
        status: "completed",
      });
    } catch (error) {
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
