import { useEffect, useRef, useState } from 'react';

interface Props {
  attachmentId: string;
  format: 'pdf' | 'docx';
}

const URL_REFRESH_MS = 55 * 60 * 1000; // refresh 5 min before 1h expiry

export function OriginalFileViewer({ attachmentId, format }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setState('loading');
    try {
      if (format === 'pdf') {
        const res = await fetch(`/api/document-files/${attachmentId}/viewer-url`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const { url } = await res.json() as { url: string };
        if (iframeRef.current) iframeRef.current.src = url;
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => void load(), URL_REFRESH_MS);
      } else {
        const res = await fetch(`/api/document-files/${attachmentId}/html`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const html = await res.text();
        if (iframeRef.current) iframeRef.current.srcdoc = html;
      }
      setState('ready');
    } catch (err) {
      setErrorMsg(String(err));
      setState('error');
    }
  }

  useEffect(() => {
    void load();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [attachmentId, format]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#111',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: state === 'ready' ? 'flex-start' : 'center',
      overflow: format === 'pdf' ? 'hidden' : 'auto',
      position: 'relative',
    }}>
      {/* Loading state */}
      {state === 'loading' && (
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 12,
          color: 'rgba(255,255,255,0.35)',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            style={{ animation: 'spin 1s linear infinite' }}>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          <span style={{ font: '400 12px/1 var(--mono)', letterSpacing: '0.05em' }}>
            Loading {format.toUpperCase()}…
          </span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error state */}
      {state === 'error' && (
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 10,
          color: 'rgba(255,255,255,0.4)',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style={{ font: '400 12px/1 var(--sans)' }}>Failed to load file</span>
          <span style={{ font: '400 11px/1 var(--mono)', opacity: 0.6 }}>{errorMsg}</span>
          <button
            onClick={() => void load()}
            style={{
              marginTop: 4,
              font: '500 11px/1 var(--sans)', color: 'var(--accent)',
              background: 'none', border: 'none', cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
            }}
          >Retry</button>
        </div>
      )}

      {/* PDF: full-area iframe, browser renders natively */}
      {format === 'pdf' && (
        <iframe
          ref={iframeRef}
          title="Original PDF"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            opacity: state === 'ready' ? 1 : 0,
            transition: 'opacity 0.25s',
          }}
          onLoad={() => setState('ready')}
        />
      )}

      {/* DOCX: centred white document card */}
      {format === 'docx' && (
        <iframe
          ref={iframeRef}
          title="Original DOCX"
          sandbox="allow-same-origin"
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 860,
            minHeight: '100%',
            border: 'none',
            background: '#fff',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.6)',
            opacity: state === 'ready' ? 1 : 0,
            transition: 'opacity 0.25s',
            margin: '32px auto',
          }}
          onLoad={() => setState('ready')}
        />
      )}
    </div>
  );
}
