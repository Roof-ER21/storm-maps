interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-sm py-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 mx-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-semibold text-stone-900">{title}</p>
        <p className="mt-2 text-sm text-stone-500">{message}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-900 hover:bg-stone-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white ${
              destructive
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
