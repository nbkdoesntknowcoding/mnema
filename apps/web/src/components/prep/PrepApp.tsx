import { useEffect, useMemo, useState } from 'react';
import rawData from '../../data/prep-questions.json';
import type { Bank, Mode, PrepData, PrepItem } from '../../lib/prep-types';
import { usePrepProgress } from './prep-storage';
import { PrepBrowse } from './PrepBrowse';
import { PrepFlashcards } from './PrepFlashcards';
import { PrepQuiz } from './PrepQuiz';
import { companyColor } from './ui';

const data = rawData as unknown as PrepData;

function toItems(bank: Bank): PrepItem[] {
  if (bank === 'interview') {
    return data.interview.map((q) => ({
      id: q.id, bank, company: q.company, group: q.category, role: q.role,
      question: q.question, promptMarkdown: null, options: null,
      answerMarkdown: q.answerMarkdown, source: q.source, topic: q.topic, isMcq: false,
    }));
  }
  return data.aptitude.map((q) => ({
    id: q.id, bank, company: q.company, group: q.section, role: null,
    question: q.question, promptMarkdown: q.promptMarkdown, options: q.options,
    answerMarkdown: (q.type === 'mcq' ? q.solutionMarkdown : q.answerMarkdown) ?? '',
    source: q.source, topic: q.topic, isMcq: q.type === 'mcq',
  }));
}

const ALL_ITEMS: Record<Bank, PrepItem[]> = { interview: toItems('interview'), aptitude: toItems('aptitude') };

type Flag = 'all' | 'bookmarked' | 'unmastered';

export function PrepApp() {
  const progress = usePrepProgress();

  const [bank, setBank] = useState<Bank>('interview');
  const [mode, setMode] = useState<Mode>('browse');
  const [company, setCompany] = useState<string>('all');
  const [group, setGroup] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [flag, setFlag] = useState<Flag>('all');

  // Deep-link init: ?bank=&company=&mode=
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const b = p.get('bank'); if (b === 'interview' || b === 'aptitude') setBank(b);
    const m = p.get('mode'); if (m === 'browse' || m === 'flashcards' || m === 'quiz') setMode(m);
    const c = p.get('company'); if (c) setCompany(c);
  }, []);

  // reset group when bank changes if invalid
  useEffect(() => { setGroup('all'); setCompany((c) => c); }, [bank]);

  const items = ALL_ITEMS[bank];
  const companies = useMemo(() => [...new Set(items.map((i) => i.company))], [items]);
  const groups = useMemo(() => [...new Set(items.filter((i) => company === 'all' || i.company === company).map((i) => i.group))], [items, company]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (company !== 'all' && it.company !== company) return false;
      if (group !== 'all' && it.group !== group) return false;
      if (flag === 'bookmarked' && !progress.isBookmarked(it.id)) return false;
      if (flag === 'unmastered' && progress.statusOf(it.id) === 'mastered') return false;
      if (q && !(it.question.toLowerCase().includes(q) || it.answerMarkdown.toLowerCase().includes(q) || (it.topic ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, company, group, flag, search, progress.bookmarks, progress.status]);

  const mastered = filtered.filter((i) => progress.statusOf(i.id) === 'mastered').length;
  const bookmarked = items.filter((i) => progress.isBookmarked(i.id)).length;

  const tab = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'var(--sans)', border: 'none',
    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink-muted)',
  });
  const chip = (active: boolean, color?: string): React.CSSProperties => ({
    padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'var(--sans)', display: 'inline-flex', alignItems: 'center', gap: 6,
    background: active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)',
    border: `0.5px solid ${active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)'}`,
    color: active ? 'var(--ink)' : 'var(--ink-soft)',
    ...(color && active ? { borderColor: color + '88' } : {}),
  });

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 20px 80px', fontFamily: 'var(--sans)' }}>
      <style>{prepCss}</style>

      {/* Header */}
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 27, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Placement Prep</h1>
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13.5 }}>
          {data.meta.counts.interview} interview questions · {data.meta.counts.aptitude} aptitude questions, sourced from verified candidate reports. Progress saves in this browser.
        </p>
      </header>

      {/* Bank + Mode tabs */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'inline-flex', gap: 3, padding: 3, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)' }}>
          <button style={tab(bank === 'interview')} onClick={() => setBank('interview')}>Interview</button>
          <button style={tab(bank === 'aptitude')} onClick={() => setBank('aptitude')}>Aptitude</button>
        </div>
        <div style={{ display: 'inline-flex', gap: 3, padding: 3, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)' }}>
          {(['browse', 'flashcards', 'quiz'] as Mode[]).map((m) => (
            <button key={m} style={tab(mode === m)} onClick={() => setMode(m)}>{m.charAt(0).toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button style={chip(company === 'all')} onClick={() => setCompany('all')}>All companies</button>
          {companies.map((c) => (
            <button key={c} style={chip(company === c, companyColor(c))} onClick={() => setCompany(c)}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: companyColor(c) }} />{c}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button style={chip(group === 'all')} onClick={() => setGroup('all')}>All topics</button>
          {groups.map((g) => (
            <button key={g} style={chip(group === g)} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions…"
            style={{ flex: '1 1 220px', minWidth: 180, height: 34, padding: '0 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: 13, outline: 'none' }}
          />
          <div style={{ display: 'inline-flex', gap: 3, padding: 3, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)' }}>
            {([['all', 'All'], ['bookmarked', `★ ${bookmarked}`], ['unmastered', 'To learn']] as [Flag, string][]).map(([f, label]) => (
              <button key={f} style={tab(flag === f)} onClick={() => setFlag(f)}>{label}</button>
            ))}
          </div>
        </div>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--mono)' }}>
          {filtered.length} shown · {mastered} mastered{flag !== 'all' ? '' : ''}
        </p>
      </div>

      {/* Active view */}
      <div style={{ marginTop: 16 }}>
        {mode === 'browse' && <PrepBrowse items={filtered} progress={progress} />}
        {mode === 'flashcards' && <PrepFlashcards items={filtered} progress={progress} />}
        {mode === 'quiz' && <PrepQuiz items={filtered} progress={progress} />}
      </div>
    </div>
  );
}

const prepCss = `
.prep-md { color: var(--ink-soft); font-size: 13.5px; line-height: 1.6; font-family: var(--sans); }
.prep-md p { margin: 0 0 8px; }
.prep-md p:last-child { margin-bottom: 0; }
.prep-md strong { color: var(--ink); font-weight: 600; }
.prep-md code { font-family: var(--mono); font-size: 12px; background: rgba(255,255,255,0.07); padding: 1px 5px; border-radius: 4px; }
.prep-md pre { background: rgba(0,0,0,0.35); border: 0.5px solid rgba(255,255,255,0.10); border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 8px 0; }
.prep-md pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.55; color: var(--ink-soft); }
.prep-md ul, .prep-md ol { margin: 6px 0; padding-left: 20px; }
.prep-md li { margin: 3px 0; }
.prep-md table { border-collapse: collapse; margin: 8px 0; font-size: 12.5px; }
.prep-md th, .prep-md td { border: 0.5px solid rgba(255,255,255,0.14); padding: 5px 10px; text-align: left; }
.prep-md th { background: rgba(255,255,255,0.05); color: var(--ink); }
.prep-md a { color: var(--accent); }
`;
