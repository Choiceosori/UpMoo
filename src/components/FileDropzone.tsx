"use client";

import { useCallback, useRef, useState } from "react";
import clsx from "clsx";

interface FileDropzoneProps {
  accept?: string;
  file: File | null;
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  helperText?: string;
}

export function FileDropzone({ accept, file, onFileSelected, disabled, helperText }: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) onFileSelected(dropped);
    },
    [disabled, onFileSelected]
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={clsx(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          disabled && "cursor-not-allowed opacity-50",
          isDragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
        )}
      >
        <span className="text-3xl">📁</span>
        {file ? (
          <div>
            <p className="font-medium text-slate-800">{file.name}</p>
            <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div>
            <p className="font-medium text-slate-700">파일을 드래그하거나 클릭하여 업로드</p>
            {helperText && <p className="mt-1 text-xs text-slate-400">{helperText}</p>}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) onFileSelected(selected);
          e.target.value = "";
        }}
      />
    </div>
  );
}
