import React, { useRef, useState } from "react";

interface FileUploadProps {
  onFileSelect: (files: File[]) => void; // Changed to accept an array of files
  disabled: boolean;
  disabledLabel?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  disabled,
  disabledLabel = "Select a device first",
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleClick = () => {
    if (!disabled) fileInputRef.current?.click();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!disabled && files && files.length > 0) {
      // Convert FileList to array and pass all files
      const filesArray = Array.from(files);
      onFileSelect(filesArray);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div
      className={
        "rounded-xl border-2 border-dashed p-6 text-center transition-colors " +
        (dragging && !disabled
          ? "border-blue-400 bg-blue-50 dark:border-violet-400 dark:bg-neutral-800"
          : "border-gray-300 dark:border-zinc-700")
      }
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled && event.dataTransfer.files.length)
          onFileSelect(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        type="file"
        disabled={disabled}
        ref={fileInputRef}
        onChange={handleChange}
        className="hidden"
        multiple // Add the multiple attribute
      />
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`min-h-11 rounded-lg px-4 py-2 text-white ${
          disabled
            ? "cursor-not-allowed bg-gray-300 dark:bg-zinc-400 dark:text-black"
            : "bg-blue-600 font-semibold hover:bg-blue-700 active:bg-blue-700 dark:bg-violet-500 dark:text-zinc-950 dark:hover:bg-violet-600 dark:active:bg-violet-600"
        }`}
      >
        {disabled ? disabledLabel : "Choose Files to Send"}
      </button>
      <p className="mt-3 text-sm text-gray-500 dark:text-zinc-400">
        {disabled ? "Up to 256 MB" : "Or drop files · Up to 256 MB"}
      </p>
    </div>
  );
};
