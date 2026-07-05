'use client';
import { useEffect, useState } from 'react';

/**
 * Animate a number from 0 → target over `duration` ms once `active` is true.
 * Eased (easeOutExpo). Respects prefers-reduced-motion by jumping to target.
 */
export function useCountUp(target: number, active: boolean, duration = 1600): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);

  return value;
}
