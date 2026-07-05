import { useEffect, useRef, useState } from 'react';

interface Props {
  attachmentId: string;
}

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (containerId: string, config: object) => { destroyEditor: () => void };
    };
  }
}

export function OnlyOfficeEditor({ attachmentId }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setState('loading');
      try {
        // 1. Fetch editor config from API
        const res = await fetch(`/api/onlyoffice/${attachmentId}/config`, {
          credentials: 'include',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const { config, apiUrl } = await res.json() as { config: object; apiUrl: string };
        if (cancelled) return;

        // 2. Dynamically load the OnlyOffice JS SDK if not already present
        const sdkUrl = `${apiUrl}/web-apps/apps/api/documents/api.js`;
        await loadScript(sdkUrl);
        if (cancelled) return;

        if (!window.DocsAPI) throw new Error('DocsAPI not loaded');

        // 3. Destroy any previous editor instance
        editorRef.current?.destroyEditor();

        // 4. Mount the editor
        editorRef.current = new window.DocsAPI.DocEditor('oo-editor-container', config);
        setState('ready');
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(String(err));
          setState('error');
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor();
      editorRef.current = null;
      // Remove the SDK script on unmount so a fresh one loads next time
      scriptRef.current?.remove();
      scriptRef.current = null;
    };
  }, [attachmentId]);

  return (
    <div style={{ width: '100%', height: '100%', background: '#111', position: 'relative' }}>
      {/* Loading overlay */}
      {state === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 12, color: 'rgba(255,255,255,0.35)', zIndex: 10,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            style={{ animation: 'oo-spin 1s linear infinite' }}>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          <span style={{ font: '400 12px/1 var(--mono)', letterSpacing: '0.05em' }}>
            Loading editor…
          </span>
          <style>{`@keyframes oo-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error overlay */}
      {state === 'error' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 10, color: 'rgba(255,255,255,0.4)', zIndex: 10,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style={{ font: '400 12px/1 var(--sans)' }}>Failed to load editor</span>
          <span style={{ font: '400 11px/1 var(--mono)', opacity: 0.6 }}>{errorMsg}</span>
          <button
            onClick={() => setState('loading')}
            style={{
              marginTop: 4, font: '500 11px/1 var(--sans)', color: 'var(--accent)',
              background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0,
            }}
          >Retry</button>
        </div>
      )}

      {/* OnlyOffice mounts here — must always be in the DOM */}
      <div
        id="oo-editor-container"
        style={{ width: '100%', height: '100%', opacity: state === 'ready' ? 1 : 0 }}
      />
    </div>
  );
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Reuse if already loaded
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}
