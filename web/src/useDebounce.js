import { useRef, useEffect, useState, useCallback } from 'react';

export function useDebouncedCallback(cb, delay = 300) {
  const cbRef = useRef(cb);
  const timeout = useRef(null);

  // Keep the latest callback reference so the debounced call never uses a
  // stale closure.
  useEffect(() => { cbRef.current = cb; }, [cb]);

  // Clear any pending timeout if the component unmounts to avoid calling the
  // callback on an unmounted component.
  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current);
  }, []);

  return useCallback((...args) => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => cbRef.current(...args), delay);
  }, [delay]);
}

export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
