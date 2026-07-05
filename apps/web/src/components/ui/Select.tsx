import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { invalid, className = '', ...props },
  ref,
) {
  return (
    <div className="relative w-full">
      <select
        ref={ref}
        className={
          'w-full h-9 pl-3 pr-8 text-[14px] appearance-none ' +
          'bg-[var(--surface-sunken)] ' +
          'border ' +
          (invalid
            ? 'border-[var(--status-error)] '
            : 'border-[var(--border-default)] hover:border-[var(--border-strong)] ') +
          'rounded-[var(--radius-md)] ' +
          'text-[var(--text-primary)] ' +
          'outline-none transition-[border-color] cursor-pointer ' +
          'focus:border-[var(--border-focus)] focus:[box-shadow:var(--focus-ring)] ' +
          'disabled:opacity-50 disabled:cursor-not-allowed ' +
          className
        }
        {...props}
      />
      <ChevronDown
        size={14}
        strokeWidth={1.75}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none"
      />
    </div>
  );
});
