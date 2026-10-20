import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@krevia/shared';

/** Loads data on mount with loading / error / retry state. */
export function useQuery<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadRef.current());
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, 'INTERNAL', 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}
