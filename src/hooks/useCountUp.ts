import { useState, useEffect, useRef } from 'react';

export function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState<number>(target);
  const currentRef = useRef<number>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const safeTarget = Number.isFinite(target) ? target : 0;
    const from = currentRef.current;

    if (from === safeTarget) {
      setDisplay(safeTarget);
      return;
    }

    // Respect reduced motion preference
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      currentRef.current = safeTarget;
      setDisplay(safeTarget);
      return;
    }

    let startTs: number | null = null;

    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const p = Math.min(1, (ts - startTs) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(from + (safeTarget - from) * eased);
      currentRef.current = val;
      setDisplay(val);

      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        currentRef.current = safeTarget;
        setDisplay(safeTarget);
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [target, duration]);

  return display;
}
