import { useEffect, useState, useCallback } from 'react';
import type { PharmacyApi, PrescriptionDetail } from '../types';
export function useMedicationPolling(
  api: PharmacyApi,
  prescriptionId: string,
  revision?: number,
) {
  const identity = prescriptionId + ':' + (revision || '');
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<{
    identity: string;
    data?: PrescriptionDetail;
    error?: unknown;
  }>();
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    setResult({ identity });
    async function load() {
      try {
        const data = await api.detail(
          prescriptionId,
          revision,
          controller.signal,
        );
        if (!active) return;
        setResult({ identity, data });
        if (['HELD', 'SETTLEMENT_LOCKED'].includes(data.latestHoldState))
          timer = setTimeout(load, 3000);
      } catch (error) {
        if (active && !controller.signal.aborted)
          setResult({ identity, error });
      }
    }
    if (prescriptionId) load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, prescriptionId, revision, identity, generation]);
  return {
    data: result?.identity === identity ? result.data : undefined,
    error: result?.identity === identity ? result.error : undefined,
    reload,
  };
}
