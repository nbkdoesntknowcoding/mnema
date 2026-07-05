import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  { invalid, className = '', ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={
        'w-full px-3 py-2 text-[14px] min-h-[80px] resize-y ' +
        'bg-[var(--surface-sunken)] ' +
        'border ' +
        (invalid
          ? 'border-[var(--status-error)] '
          : 'border-[var(--border-default)] hover:border-[var(--border-strong)] ') +
        'rounded-[var(--radius-md)] ' +
        'text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] ' +
        'outline-none transition-[border-color] leading-[1.5] ' +
        'focus:border-[var(--border-focus)] focus:[box-shadow:var(--focus-ring)] ' +
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        className
      }
      {...props}
    />
  );
});
