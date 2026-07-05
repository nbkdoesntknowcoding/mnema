import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { invalid, className = '', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={
        'w-full ' +
        'font-[400] text-[14px] leading-[1.4] ' +
        'px-[14px] py-[11px] ' +
        'bg-[var(--canvas)] text-[var(--ink)] ' +
        'border rounded-[var(--r-3)] ' +
        'outline-none ' +
        'transition-[border-color,box-shadow] duration-[140ms] ease-out ' +
        'placeholder:text-[var(--ink-muted)] ' +
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        (invalid
          ? 'border-[var(--status-error)] focus:border-[var(--status-error)] focus:[box-shadow:0_0_0_3px_var(--status-error-bg)] '
          : 'border-[var(--line-strong)] hover:border-[var(--line-bright)] focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--accent-soft)] ') +
        className
      }
      {...props}
    />
  );
});
