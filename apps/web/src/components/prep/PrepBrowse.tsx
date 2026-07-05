import { useState } from 'react';
import type { PrepItem } from '../../lib/prep-types';
import type { PrepProgress } from './prep-storage';
import { Markdown } from './markdown';
import { Badge, BookmarkButton, SourceChip, StatusPills, companyColor } from './ui';

function OptionList({ item, revealed }: { item: PrepItem; revealed: boolean }) {
  if (!item.options) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
      {item.options.map((o) => {
        const show = revealed && o.correct;
        return (
          <div key={o.label} style={{
            display: 'flex', gap: 8, padding: '8px 11px', borderRadius: 7, fontSize: 13.5,
            fontFamily: 'var(--sans)',
            background: show ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.03)',
            border: `0.5px solid ${show ? 'rgba(74,222,128,0.45)' : 'rgba(255,255,255,0.08)'}`,
            color: show ? '#9af3b8' : 'var(--ink-soft)',
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, opacity: 0.8 }}>{o.label}</span>
            <span>{o.text}</span>
            {show && <span style={{ marginLeft: 'auto', color: '#4ade80' }}>✓</span>}
          </div>
        );
      })}
    </div>
  );
}

function Card({ item, progress }: { item: PrepItem; progress: PrepProgress }) {
  const [open, setOpen] = useState(false);
  const status = progress.statusOf(item.id);
  const accent = status === 'mastered' ? '#4ade80' : status === 'review' ? '#fbbf24' : 'transparent';
  return (
    <div style={{
      borderRadius: 10, background: 'rgba(255,255,255,0.035)',
      border: '0.5px solid rgba(255,255,255,0.10)',
      borderLeft: `2px solid ${accent === 'transparent' ? 'rgba(255,255,255,0.10)' : accent}`,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
          cursor: 'pointer', padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 9,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Badge color={companyColor(item.company)}>{item.company}</Badge>
          <Badge>{item.group}</Badge>
          {item.topic && <Badge>{item.topic}</Badge>}
          {item.isMcq && <Badge>MCQ</Badge>}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            <BookmarkButton active={progress.isBookmarked(item.id)} onClick={() => progress.toggleBookmark(item.id)} />
            <span style={{ color: 'var(--ink-muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>{open ? '–' : '+'}</span>
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.45, color: 'var(--ink)', fontWeight: 500, fontFamily: 'var(--sans)' }}>
          {item.question}
        </p>
      </button>

      {open && (
        <div style={{ padding: '0 15px 15px' }}>
          {item.promptMarkdown && <Markdown md={item.promptMarkdown} />}
          {item.options && <OptionList item={item} revealed />}
          {item.answerMarkdown && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', fontFamily: 'var(--mono)' }}>
                {item.isMcq ? 'Solution' : 'Model answer'}
              </p>
              <Markdown md={item.answerMarkdown} />
            </div>
          )}
          <SourceChip source={item.source} />
          <div style={{ marginTop: 12 }}><StatusPills id={item.id} progress={progress} /></div>
        </div>
      )}
    </div>
  );
}

export function PrepBrowse({ items, progress }: { items: PrepItem[]; progress: PrepProgress }) {
  if (items.length === 0) {
    return <p style={{ color: 'var(--ink-muted)', fontFamily: 'var(--sans)', padding: '40px 0', textAlign: 'center' }}>No questions match these filters.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it) => <Card key={it.id} item={it} progress={progress} />)}
    </div>
  );
}
