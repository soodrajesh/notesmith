import { useCallback, useEffect, useRef, useState } from 'react';

const FLASH_MS = 2500;

/** A transient status-bar message; a newer message restarts the timer instead of being cut short by the old one. */
export function useFlash() {
  const [status, setStatus] = useState('');
  const timer = useRef<number | null>(null);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(''), FLASH_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return { status, flash };
}
