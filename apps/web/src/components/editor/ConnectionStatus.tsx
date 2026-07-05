import type { HocuspocusProvider } from '@hocuspocus/provider';
import { type JSX, useEffect, useState } from 'react';

type Status = 'connecting' | 'connected' | 'synced' | 'disconnected';

interface Props {
  provider: HocuspocusProvider | null;
}

export function ConnectionStatus({ provider }: Props): JSX.Element {
  const [status, setStatus] = useState<Status>('connecting');
  const [peers, setPeers] = useState(0);

  useEffect(() => {
    if (!provider) return;

    const onStatus = ({ status: s }: { status: string }): void => {
      if (s === 'connected') setStatus('connected');
      else if (s === 'disconnected') setStatus('disconnected');
    };
    const onSynced = (): void => setStatus('synced');
    const onAwareness = (): void => {
      const states = provider.awareness?.getStates() ?? new Map<number, unknown>();
      setPeers(Math.max(0, states.size - 1));
    };

    provider.on('status', onStatus);
    provider.on('synced', onSynced);
    provider.on('awarenessUpdate', onAwareness);
    onAwareness();

    return () => {
      provider.off('status', onStatus);
      provider.off('synced', onSynced);
      provider.off('awarenessUpdate', onAwareness);
    };
  }, [provider]);

  const label =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'connected'
        ? 'Connected'
        : status === 'synced'
          ? peers > 0
            ? `Synced · ${peers} other${peers === 1 ? '' : 's'}`
            : 'Synced'
          : 'Disconnected';

  return <div className={`connection-status connection-status--${status}`}>{label}</div>;
}
