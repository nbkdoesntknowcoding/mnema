import type { HTMLAttributes } from 'react';

/**
 * Hero display heading — Instrument Serif, large, tight tracking.
 *
 * Use ONLY on marketing pages and landing heroes. NEVER in app UI.
 * For a mixed Geist + serif headline, use MixedHeading instead.
 */
export function DisplayHeading({
  children,
  size = 'lg',
  className = '',
  ...props
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
} & HTMLAttributes<HTMLHeadingElement>) {
  const sizes = {
    sm: 'text-[40px] leading-[1.05]',
    md: 'text-[56px] leading-[1.05]',
    lg: 'text-[72px] leading-[1.02]',
    xl: 'text-[96px] leading-[1.0]',
  };
  return (
    <h1
      className={
        "font-['Instrument_Serif'] font-normal " +
        sizes[size] + ' ' +
        'tracking-[-0.02em] ' +
        'text-[var(--text-primary)] ' +
        className
      }
      {...props}
    >
      {children}
    </h1>
  );
}

/**
 * Mixed-face heading — Geist Sans base with an optional Instrument Serif
 * italic emphasis word inside.
 *
 * Usage:
 *   <MixedHeading size="lg">
 *     The live{' '}
 *     <em className="font-['Instrument_Serif'] italic font-normal">context engine</em>
 *     {' '}for AI-native teams.
 *   </MixedHeading>
 *
 * Use on marketing pages only. Never in app UI.
 */
export function MixedHeading({
  children,
  size = 'md',
  className = '',
  ...props
}: {
  size?: 'sm' | 'md' | 'lg';
} & HTMLAttributes<HTMLHeadingElement>) {
  const sizes = {
    sm: 'text-[32px] leading-[1.15]',
    md: 'text-[48px] leading-[1.1]',
    lg: 'text-[64px] leading-[1.05]',
  };
  return (
    <h1
      className={
        'font-sans font-medium ' +
        sizes[size] + ' ' +
        'tracking-[-0.02em] ' +
        'text-[var(--text-primary)] ' +
        className
      }
      {...props}
    >
      {children}
    </h1>
  );
}

export function PageHeading({ children, className = '', ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      className={
        'text-[28px] leading-[1.3] tracking-[-0.01em] ' +
        'font-medium text-[var(--text-primary)] ' +
        className
      }
      {...props}
    >
      {children}
    </h1>
  );
}

export function SectionHeading({ children, className = '', ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={
        'text-[18px] leading-[1.3] ' +
        'font-medium text-[var(--text-primary)] ' +
        className
      }
      {...props}
    >
      {children}
    </h2>
  );
}

export function MetaText({ children, className = '', ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={
        'text-[12px] leading-[1.4] ' +
        'text-[var(--text-tertiary)] ' +
        className
      }
      {...props}
    >
      {children}
    </p>
  );
}

export function MonoLabel({ children, className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={
        'font-mono text-[11px] uppercase tracking-[0.08em] ' +
        'text-[var(--text-tertiary)] ' +
        className
      }
      {...props}
    >
      {children}
    </span>
  );
}
