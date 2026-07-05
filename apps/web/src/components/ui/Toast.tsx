import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

const icons: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error:   XCircle,
  info:    Info,
};

const colors: Record<ToastTone, { text: string; icon: string }> = {
  success: { text: 'text-[var(--ink)]',      icon: 'text-[var(--status-sync)]' },
  error:   { text: 'text-[var(--ink)]',      icon: 'text-[var(--status-error)]' },
  info:    { text: 'text-[var(--ink)]',       icon: 'text-[var(--status-info-color)]' },
};

function ToastItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const Icon = icons[toast.tone];
  const { text, icon } = colors[toast.tone];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 250);
    }, toast.duration ?? 4000);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-[var(--r-4)] shadow-[var(--shadow-lg)] transition-[opacity,transform] duration-[250ms]"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--line-strong)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        minWidth: '280px',
        maxWidth: '380px',
      }}
    >
      <Icon size={16} strokeWidth={1.75} className={`flex-shrink-0 ${icon}`} />
      <span className={`flex-1 text-[13.5px] leading-[1.4] ${text}`}>{toast.message}</span>
      {toast.action && (
        <button
          onClick={toast.action.onClick}
          className="text-[12px] font-[500] text-[var(--accent)] hover:underline flex-shrink-0"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        className="w-5 h-5 flex items-center justify-center rounded-[var(--r-1)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors flex-shrink-0"
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function toast(tone: ToastTone, message: string, opts?: Omit<ToastItem, 'id' | 'tone' | 'message'>) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, tone, message, ...opts }]);
  }

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, dismiss, toast };
}
