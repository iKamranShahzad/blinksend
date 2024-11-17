export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const createChunkedStream = async (
  file: File,
  chunkSize: number,
  onChunk: (chunk: ArrayBuffer, index: number) => Promise<void>,
) => {
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let index = 0; index < totalChunks; index++) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    const arrayBuffer = await chunk.arrayBuffer();
    await onChunk(arrayBuffer, index);

    // Small delay to prevent overwhelming the WebSocket
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
