import { useCallback, useEffect, useState } from "react";
import type { AppointmentApi, AppointmentSummary } from "../types";

const TERMINAL_STATES = new Set(["CONFIRMED", "EXPIRED", "CANCELLED", "COMPLETED"]);

export function useAppointmentPolling(api: AppointmentApi, appointmentId: string, options: { intervalMs?: number; maxIntervalMs?: number } = {}) {
  const [data, setData] = useState<AppointmentSummary>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const intervalMs = options.intervalMs ?? 3000;
  const maxIntervalMs = options.maxIntervalMs ?? 15000;

  const load = useCallback(() => {
    const controller = new AbortController();
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let delay = intervalMs;
    setLoading(true);
    setError(undefined);

    const schedule = () => {
      if (!disposed) timeout = setTimeout(run, delay);
    };
    const run = async () => {
      try {
        const result = await api.getAppointment(appointmentId, controller.signal);
        if (disposed) return;
        setData(result);
        setLoading(false);
        const state = String(result.appointment?.state ?? result.state);
        if (!TERMINAL_STATES.has(state)) { delay = intervalMs; schedule(); }
      } catch (caught) {
        if (disposed || controller.signal.aborted) return;
        setError(caught);
        setLoading(false);
        const status = (caught as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) return;
        delay = Math.min(delay * 2, maxIntervalMs);
        schedule();
      }
    };
    void run();
    return () => { disposed = true; controller.abort(); if (timeout) clearTimeout(timeout); };
  }, [api, appointmentId, intervalMs, maxIntervalMs]);

  useEffect(() => load(), [load]);
  return { data, error, loading, retry: load };
}
