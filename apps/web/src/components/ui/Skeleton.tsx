export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={
        'animate-pulse bg-[var(--surface-2)] ' +
        'rounded-[var(--r-3)] ' +
        className
      }
    />
  );
}
