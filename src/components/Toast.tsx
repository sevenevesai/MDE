import { useState, useEffect, useCallback, useRef } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
  kind: "error" | "info";
  /** Optional action button. Toasts with an action never auto-dismiss. */
  action?: ToastAction;
}

let nextId = 0;

/** Hook that manages toast state. Returns [toasts, showToast, ToastContainer]. */
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const show = useCallback(
    (text: string, kind: "error" | "info" = "error", action?: ToastAction) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, text, kind, action }]);
    },
    []
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast: show, dismissToast: dismiss };
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-8 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Toasts with an action persist until the user acts or dismisses them.
    if (toast.action) return;
    timerRef.current = setTimeout(() => onDismiss(toast.id), 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [toast.id, toast.action, onDismiss]);

  const bg = toast.kind === "error" ? "bg-red-900/90 border-red-700" : "bg-bg-secondary border-border";

  return (
    <div
      className={`px-4 py-2.5 rounded border text-xs text-text-primary shadow-lg flex items-start gap-2 ${bg}`}
    >
      <span className="flex-1">{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); onDismiss(toast.id); }}
          className="shrink-0 font-medium text-accent hover:underline"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-text-muted hover:text-text-primary shrink-0"
      >
        ✕
      </button>
    </div>
  );
}
