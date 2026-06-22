"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const confirmLabel = confirmText ?? t("common.delete");
  const cancelLabel = cancelText ?? t("common.cancel");

  // Portal to document.body so ancestors with `transform` can't trap the
  // fixed-position backdrop inside their containing block.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-(--card) rounded-2xl shadow-2xl border border-(--card-border) p-6 w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-150">
        <h3 className="text-sm font-semibold text-foreground mb-1.5">{title}</h3>
        <p className="text-[13px] text-(--muted) mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="cursor-pointer text-xs font-medium text-(--muted) hover:text-foreground px-4 py-2 rounded-lg hover:bg-(--accent-light) transition-colors">
            {cancelLabel}
          </button>
          <button onClick={onConfirm}
            className={`cursor-pointer text-xs font-medium text-white px-4 py-2 rounded-lg transition-colors ${
              danger ? "bg-red-500 hover:bg-red-600" : "bg-(--accent) hover:bg-(--accent-hover)"
            }`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
