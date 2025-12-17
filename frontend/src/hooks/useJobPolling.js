import { useEffect, useRef, useState, useCallback } from 'react';
import { apiClient } from '../apiClient';

const STOP_STATUSES = ['succeeded', 'failed'];

export function useJobPolling(jobId, options = {}) {
  const { interval = 3000, timeoutMs = 120000 } = options;

  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = null;
    setIsPolling(false);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      stopPolling();
      return undefined;
    }

    let cancelled = false;
    startTimeRef.current = Date.now();
    setError(null);
    setIsPolling(true);

    const fetchJob = async () => {
      try {
        const response = await apiClient.get(`/jobs/${jobId}`);
        if (cancelled) return;

        const data = response.data;
        setJob(data);

        if (STOP_STATUSES.includes(data?.status)) {
          stopPolling();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err);
        stopPolling();
      }
    };

    fetchJob();

    timerRef.current = setInterval(() => {
      if (cancelled) {
        stopPolling();
        return;
      }

      if (timeoutMs && startTimeRef.current && Date.now() - startTimeRef.current >= timeoutMs) {
        setError(new Error('Job polling timed out'));
        stopPolling();
        return;
      }

      fetchJob();
    }, interval);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [jobId, interval, stopPolling, timeoutMs]);

  return { job, error, isPolling, stopPolling };
}
