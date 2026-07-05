import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink';
type Size = 'sm' | 'md' | 'lg' | 'icon';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', className = '', ...props },
  ref,
) {
  const base =
    'inline-flex items-center justify-center font-[600] leading-none ' +
    'transition-[background,border-color,color,transform] duration-[140ms] ease-out ' +
    'outline-none focus-visible:[box-shadow:var(--focus-ring)] ' +
    'disabled:opacity-50 disabled:cursor-not-allowed select-none ' +
    'active:translate-y-px cursor-pointer';

  const sizes: Record<Size, string> = {
    sm:   'h-7 px-[calc(var(--pad-ctl-x)*0.75)] text-[12.5px] gap-1.5 rounded-[var(--r-2)]',
    md:   'h-8 px-[var(--pad-ctl-x)] text-[13.5px] gap-1.5 rounded-[var(--r-3)]',
    lg:   'h-10 px-[calc(var(--pad-ctl-x)*1.2)] text-[14.5px] gap-2 rounded-[var(--r-3)]',
    icon: 'w-9 h-9 p-0 rounded-[var(--r-3)]',
  };

  const variants: Record<Variant, string> = {
    primary:
      'bg-[var(--accent)] text-[var(--on-ink)] border border-[var(--accent)] ' +
      'hover:bg-[color-mix(in_oklab,var(--accent)_88%,white)]',
    ink:
      'bg-[var(--ink)] text-[var(--on-ink)] border border-[var(--ink)] ' +
      'hover:bg-[color-mix(in_oklab,var(--ink)_88%,var(--ink-soft))]',
    secondary:
      'bg-[var(--surface-2)] text-[var(--ink)] border border-[var(--line-strong)] ' +
      'hover:bg-[var(--surface-3)] hover:border-[var(--line-bright)]',
    ghost:
      'bg-transparent text-[var(--ink-soft)] border border-transparent ' +
      'hover:bg-[var(--surface)] hover:text-[var(--ink)]',
    danger:
      'bg-transparent text-[var(--status-error)] border border-transparent ' +
      'hover:bg-[var(--status-error-bg)]',
  };

  return (
    <button
      ref={ref}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
});
