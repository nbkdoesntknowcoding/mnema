import { useEffect, useMemo, useState } from 'react';
import type { PrepItem } from '../../lib/prep-types';
import type { PrepProgress } from './prep-storage';
import { Markdown } from './markdown';
import { Badge, SourceChip, companyColor } from './ui';

const btn = (primary?: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--sans)',
  background: primary ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
  border: primary ? 'none' : '0.5px solid rgba(255,255,255,0.14)',
  color: primary ? '#1a1100' : 'var(--ink)',
});

export function PrepQuiz({ items, progress }: { items: PrepItem[]; progress: PrepProgress }) {
  const [pos, setPos] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);  // option label for mcq
  const [revealed, setRevealed] = useState(false);            // for open questions
  const [score, setScore] = useState({ correct: 0, answered: 0 });

  // Reset only when the actual question SET changes (not when progress mutates the
  // array identity), so answering a question doesn't wipe the session.
  const idsKey = items.map((i) => i.id).join(',');
  useEffect(() => { setPos(0); setPicked(null); setRevealed(false); setScore({ correct: 0, answered: 0 }); }, [idsKey]);

  const cur = items[pos];
  const correctLabel = useMemo(() => cur?.options?.find((o) => o.correct)?.label ?? null, [cur]);

  if (items.length === 0) {
    return <p style={{ color: 'var(--ink-muted)', fontFamily: 'var(--sans)', padding: '40px 0', textAlign: 'center' }}>No questions match these filters.</p>;
  }

  if (cur == null) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', padding: '40px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--sans)', color: 'var(--ink)', fontSize: 24 }}>Session complete</h2>
        {score.answered > 0 && (
          <p style={{ margin: 0, fontFamily: 'var(--mono)', color: 'var(--ink-soft)', fontSize: 15 }}>
            Graded score: <strong style={{ color: 'var(--accent)' }}>{score.correct}/{score.answered}</strong>{' '}
            ({Math.round((score.correct / score.answered) * 100)}%)
          </p>
        )}
        <div><button style={btn(true)} onClick={() => { setPos(0); setPicked(null); setRevealed(false); setScore({ correct: 0, answered: 0 }); }}>Restart</button></div>
      </div>
    );
  }

  const item = cur; // narrowed to PrepItem past the guard

  function pick(label: string) {
    if (picked) return;
    setPicked(label);
    const ok = label === correctLabel;
    setScore((s) => ({ correct: s.correct + (ok ? 1 : 0), answered: s.answered + 1 }));
    progress.setStatus(item.id, ok ? 'mastered' : 'review');
  }

  function next() { setPos((p) => p + 1); setPicked(null); setRevealed(false); }

  const answered = item.isMcq ? picked != null : revealed;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--mono)' }}>{pos + 1} / {items.length}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: 'var(--mono)' }}>
          {score.answered > 0 && `score ${score.correct}/${score.answered}`}
        </span>
      </div>

      <div style={{ borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.12)', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Badge color={companyColor(item.company)}>{item.company}</Badge>
          <Badge>{item.group}</Badge>
          {item.topic && <Badge>{item.topic}</Badge>}
        </div>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.4, color: 'var(--ink)', fontWeight: 500, fontFamily: 'var(--sans)' }}>{item.question}</p>
        {item.promptMarkdown && <Markdown md={item.promptMarkdown} />}

        {item.isMcq && item.options && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {item.options.map((o) => {
              let bg = 'rgba(255,255,255,0.03)', bd = 'rgba(255,255,255,0.08)', col = 'var(--ink-soft)';
              if (picked) {
                if (o.correct) { bg = 'rgba(74,222,128,0.12)'; bd = 'rgba(74,222,128,0.5)'; col = '#9af3b8'; }
                else if (o.label === picked) { bg = 'rgba(248,113,113,0.12)'; bd = 'rgba(248,113,113,0.5)'; col = '#fca5a5'; }
              }
              return (
                <button key={o.label} onClick={() => pick(o.label)} disabled={!!picked}
                  style={{
                    display: 'flex', gap: 9, alignItems: 'center', textAlign: 'left', width: '100%',
                    padding: '10px 13px', borderRadius: 8, fontSize: 14, fontFamily: 'var(--sans)',
                    background: bg, border: `0.5px solid ${bd}`, color: col,
                    cursor: picked ? 'default' : 'pointer',
                  }}>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, opacity: 0.85 }}>{o.label}</span>
                  <span>{o.text}</span>
                  {picked && o.correct && <span style={{ marginLeft: 'auto' }}>✓</span>}
                  {picked && !o.correct && o.label === picked && <span style={{ marginLeft: 'auto' }}>✕</span>}
                </button>
              );
            })}
          </div>
        )}

        {!item.isMcq && !revealed && (
          <button style={btn(true)} onClick={() => setRevealed(true)}>Reveal model answer</button>
        )}

        {answered && (
          <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
            {item.isMcq && (
              <p style={{ margin: '0 0 8px', fontWeight: 600, fontFamily: 'var(--sans)', color: picked === correctLabel ? '#4ade80' : '#fca5a5' }}>
                {picked === correctLabel ? 'Correct ✓' : `Incorrect — answer is ${correctLabel}`}
              </p>
            )}
            {item.answerMarkdown && <Markdown md={item.answerMarkdown} />}
            <SourceChip source={item.source} />
            {!item.isMcq && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button style={{ ...btn(), background: 'rgba(251,191,36,0.14)', border: '0.5px solid rgba(251,191,36,0.4)', color: '#fbbf24' }} onClick={() => { progress.setStatus(item.id, 'review'); next(); }}>↻ Review</button>
                <button style={{ ...btn(), background: 'rgba(74,222,128,0.14)', border: '0.5px solid rgba(74,222,128,0.4)', color: '#4ade80' }} onClick={() => { progress.setStatus(item.id, 'mastered'); next(); }}>✓ Got it</button>
              </div>
            )}
          </div>
        )}
      </div>

      {(item.isMcq ? picked != null : false) && (
        <div style={{ textAlign: 'center' }}>
          <button style={btn(true)} onClick={next}>{pos === items.length - 1 ? 'Finish' : 'Next question →'}</button>
        </div>
      )}
    </div>
  );
}
