import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const widths = {
  sm: '400px',
  md: '520px',
  lg: '680px',
};

export function Modal({ open, onClose, title, children, footer, width = 'md' }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-[var(--r-5)] overflow-hidden"
        style={{
          width: '100%',
          maxWidth: widths[width],
          background: 'var(--surface)',
          border: '1px solid var(--line-strong)',
          boxShadow: 'var(--shadow-lg), inset 0 1px 0 var(--line-bright)',
        }}
      >
        {/* Header */}
        {title && (
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderBottom: '1px solid var(--line)' }}
          >
            <span
              className="font-[600] text-[15px] leading-none text-[var(--ink)]"
              style={{ letterSpacing: '-0.01em' }}
            >
              {title}
            </span>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-[var(--r-2)] text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors"
            >
              <X size={15} strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 px-6 py-5 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className="flex items-center justify-end gap-2 px-6 py-4"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
