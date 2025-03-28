import React, { useRef } from "react";

interface FileUploadProps {
  onFileSelect: (files: File[]) => void; // Changed to accept an array of files
  disabled: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  disabled,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      // Convert FileList to array and pass all files
      const filesArray = Array.from(files);
      onFileSelect(filesArray);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="text-center">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleChange}
        className="hidden"
        multiple // Add the multiple attribute
      />
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`rounded-lg px-4 py-2 text-white ${
          disabled
            ? "cursor-not-allowed bg-gray-300 dark:bg-zinc-400 dark:text-black"
            : "bg-blue-500 font-semibold hover:bg-blue-600 active:bg-blue-700 dark:bg-violet-500 dark:text-zinc-950 dark:hover:bg-violet-600 dark:active:bg-violet-600"
        }`}
      >
        {disabled ? "Select a device first" : "Choose Files to Send"}
      </button>
    </div>
  );
};
