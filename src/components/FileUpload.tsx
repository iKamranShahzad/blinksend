import React, { useRef } from "react";

interface FileUploadProps {
  onFileSelect: (file: File) => void;
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
    const file = event.target.files?.[0];
    if (file) {
      onFileSelect(file);
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
      />
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`rounded-lg px-4 py-2 text-white ${
          disabled
            ? "bg-gray-300"
            : "bg-blue-500 hover:bg-blue-600 active:bg-blue-700"
        }`}
      >
        {disabled ? "Select a device first" : "Choose File to Send"}
      </button>
    </div>
  );
};
