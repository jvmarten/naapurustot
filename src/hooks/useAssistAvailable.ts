import { useCallback, useState } from 'react';
import { api } from '../utils/api';

/**
 * AS-1: whether the AI assistant is configured on the backend.
 *
 * The probe is LAZY — nothing is fetched until `probe()` is called (the Tools menu
 * fires it on first open), so an anonymous visitor who only looks at the map never
 * touches the API server, matching the app's no-network-until-needed posture. The
 * result is cached at module scope, so it is fetched at most once per session.
 */
let cached: boolean | null = null;
let inFlight = false;

export function useAssistAvailable(): { available: boolean; probe: () => void } {
  const [available, setAvailable] = useState<boolean>(cached ?? false);

  const probe = useCallback(() => {
    if (cached !== null) {
      setAvailable(cached);
      return;
    }
    if (inFlight) return;
    inFlight = true;
    api.getAssistStatus()
      .then((r) => {
        cached = Boolean(r.data?.configured);
        setAvailable(cached);
      })
      .catch(() => {
        // Leave `cached` null on a transient failure so a later open can retry.
      })
      .finally(() => {
        inFlight = false;
      });
  }, []);

  return { available, probe };
}
