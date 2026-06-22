"use client";

import { useEffect } from "react";

export default function Toast({
  message,
  open,
  onClose,
  duration = 1500,
  onClick,
  variant = "default",
}: {
  message: string;
  open: boolean;
  onClose: () => void;
  duration?: number;
  onClick?: () => void;
  variant?: "default" | "notification";
}) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [open, duration, onClose]);

  if (!open) return null;

  if (variant === "notification") {
    return (
      <div className="fixed top-4 right-4 z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
        <button onClick={() => { onClick?.(); onClose(); }}
          className="flex items-center gap-3 bg-white border border-neutral-200 shadow-2xl rounded-2xl px-5 py-3.5 hover:bg-neutral-50 transition-colors">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
          <div className="text-left">
            <p className="text-[12px] font-semibold text-neutral-800">{message}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">Click to view</p>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="bg-neutral-900 text-white text-xs font-medium px-4 py-2.5 rounded-full shadow-lg">
        {message}
      </div>
    </div>
  );
}
