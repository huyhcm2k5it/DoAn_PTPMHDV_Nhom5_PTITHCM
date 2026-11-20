import { useEffect, useRef, useState } from 'react';

export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const alive = useRef(true);
  const executing = useRef(false);
  const attempt = useRef<{
    key: string;
    run: (key: string) => Promise<unknown>;
    success: (value: unknown) => void;
    message: string;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function retry() {
    const current = attempt.current;
    if (!current || executing.current) return;
    executing.current = true;
    setBusy(true);
    setError(undefined);
    setNotice('');
    try {
      const value = await current.run(current.key);
      if (!alive.current) return;
      attempt.current = null;
      setUncertain(false);
      current.success(value);
      setNotice(current.message);
    } catch (e) {
      if (!alive.current) return;
      setError(e);
      const status = (e as { status?: number })?.status;
      if (status && [400, 403, 404, 409, 422].includes(status)) {
        attempt.current = null;
        setUncertain(false);
        setConflict(status === 409);
      } else setUncertain(true);
    } finally {
      executing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function perform<T>(
    run: (key: string) => Promise<T>,
    success: (value: T) => void,
    message: string,
  ) {
    if (attempt.current || executing.current || conflict) return;
    attempt.current = {
      key: crypto.randomUUID(),
      run,
      success: (value) => success(value as T),
      message,
    };
    void retry();
  }
  return {
    busy,
    error,
    uncertain,
    notice,
    conflict,
    locked: busy || uncertain || conflict,
    perform,
    retry,
    resolveConflict: () => {
      setConflict(false);
      setError(undefined);
    },
    clearNotice: () => setNotice(''),
  };
}
