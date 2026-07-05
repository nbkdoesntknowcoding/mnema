import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PrepItem } from '../../lib/prep-types';
import type { PrepProgress } from './prep-storage';
import { Markdown } from './markdown';
import { Badge, BookmarkButton, SourceChip, companyColor } from './ui';

const btn = (primary?: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'var(--sans)',
  background: primary ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
  border: primary ? 'none' : '0.5px solid rgba(255,255,255,0.14)',
  color: primary ? '#1a1100' : 'var(--ink)',
});

export function PrepFlashcards({ items, progress }: { items: PrepItem[]; progress: PrepProgress }) {
  const [seed, setSeed] = useState(0);
  const order = useMemo(() => {
    const arr = items.map((_, i) => i);
    if (seed > 0) for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(((Math.sin(seed * 99 + i) + 1) / 2) * (i + 1));
      const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t;
    }
    return arr;
  }, [items, seed]);

  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const idsKey = items.map((i) => i.id).join(',');
  useEffect(() => { setPos(0); setRevealed(false); }, [idsKey, seed]);

  const item = items[order[Math.min(pos, order.length - 1)] ?? 0];

  const go = useCallback((d: number) => {
    setRevealed(false);
    setPos((p) => Math.max(0, Math.min(order.length - 1, p + d)));
  }, [order.length]);

  const rate = useCallback((s: 'mastered' | 'review') => {
    if (item) progress.setStatus(item.id, s);
    if (pos < order.length - 1) { setRevealed(false); setPos((p) => p + 1); }
  }, [item, pos, order.length, progress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); setRevealed((v) => !v); }
      else if (e.code === 'ArrowRight') go(1);
      else if (e.code === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (items.length === 0) {
    return <p style={{ color: 'var(--ink-muted)', fontFamily: 'var(--sans)', padding: '40px 0', textAlign: 'center' }}>No questions match these filters.</p>;
  }
  if (!item) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 720 }}>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--mono)' }}>{pos + 1} / {order.length}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn()} onClick={() => setSeed((s) => s + 1)}>⤮ Shuffle</button>
        </div>
      </div>

      <div
        onClick={() => setRevealed((v) => !v)}
        style={{
          width: '100%', maxWidth: 720, minHeight: 280, cursor: 'pointer',
          borderRadius: 14, background: 'rgba(255,255,255,0.04)',
          border: '0.5px solid rgba(255,255,255,0.12)', padding: '22px 24px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Badge color={companyColor(item.company)}>{item.company}</Badge>
          <Badge>{item.group}</Badge>
          {item.topic && <Badge>{item.topic}</Badge>}
          <span style={{ marginLeft: 'auto' }}><BookmarkButton active={progress.isBookmarked(item.id)} onClick={() => progress.toggleBookmark(item.id)} /></span>
        </div>

        <p style={{ margin: 0, fontSize: 18, lineHeight: 1.4, color: 'var(--ink)', fontWeight: 500, fontFamily: 'var(--sans)' }}>{item.question}</p>
        {item.promptMarkdown && <Markdown md={item.promptMarkdown} />}
        {item.options && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {item.options.map((o) => {
              const show = revealed && o.correct;
              return (
                <div key={o.label} style={{
                  display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 6, fontSize: 13.5, fontFamily: 'var(--sans)',
                  background: show ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.03)',
                  border: `0.5px solid ${show ? 'rgba(74,222,128,0.45)' : 'rgba(255,255,255,0.07)'}`,
                  color: show ? '#9af3b8' : 'var(--ink-soft)',
                }}>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, opacity: 0.8 }}>{o.label}</span>{o.text}
                  {show && <span style={{ marginLeft: 'auto' }}>✓</span>}
                </div>
              );
            })}
          </div>
        )}

        {!revealed ? (
          <p style={{ marginTop: 'auto', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--mono)', textAlign: 'center' }}>
            click or press <kbd style={{ fontFamily: 'var(--mono)' }}>space</kbd> to reveal
          </p>
        ) : (
          <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
            {item.answerMarkdown
              ? <Markdown md={item.answerMarkdown} />
              : <p style={{ color: 'var(--ink-muted)', margin: 0 }}>See highlighted option above.</p>}
            <SourceChip source={item.source} />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 720, justifyContent: 'center', alignItems: 'center' }}>
        <button style={btn()} onClick={() => go(-1)} disabled={pos === 0}>← Prev</button>
        {revealed && (
          <>
            <button style={{ ...btn(), background: 'rgba(251,191,36,0.14)', border: '0.5px solid rgba(251,191,36,0.4)', color: '#fbbf24' }} onClick={() => rate('review')}>↻ Review</button>
            <button style={{ ...btn(), background: 'rgba(74,222,128,0.14)', border: '0.5px solid rgba(74,222,128,0.4)', color: '#4ade80' }} onClick={() => rate('mastered')}>✓ Got it</button>
          </>
        )}
        <button style={btn()} onClick={() => go(1)} disabled={pos === order.length - 1}>Next →</button>
      </div>
    </div>
  );
}
