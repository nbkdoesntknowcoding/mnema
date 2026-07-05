'use client';
import { useEffect, useMemo, useState } from 'react';

interface Session {
  id: string;
  developerId: string;
  totalCostUsd: number;
  status: string;
  startedAt: string;
  endedAt?: string | null;
}

interface DailyEntry {
  date: string;
  costUsd: number;
  byDeveloper?: Record<string, number>;
  byAgent?: Record<string, number>;
}

type Period = 'week' | 'month' | 'all';

const AVATAR_PALETTE = ['#fbbf24', '#a78bfa', '#4ade80', '#60a5fa', '#f87171', '#fb923c'];

function hashDevId(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const i1 = ((h >>> 0) % AVATAR_PALETTE.length);
  const i2 = ((Math.abs(h) + 2) % AVATAR_PALETTE.length);
  return [AVATAR_PALETTE[i1] ?? '#fbbf24', AVATAR_PALETTE[i2] ?? '#a78bfa'];
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 80, h = 28;
  const max = Math.max(...data, 0.0001);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function TeamPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [period, setPeriod] = useState<Period>('month');

  useEffect(() => {
    void (async () => {
      try {
        const [s, d] = await Promise.all([
          fetch('/api/sessions?limit=500').then((r) => r.json()) as Promise<{ sessions: Session[] }>,
          fetch('/api/dev/cost-daily').then((r) => r.json()) as Promise<{ daily: DailyEntry[] }>,
        ]);
        setSessions(s.sessions ?? []);
        setDaily(d.daily ?? []);
      } catch { /* offline */ }
    })();
  }, []);

  const now = Date.now();
  const cutoff = period === 'week' ? now - 7 * 86400_000
    : period === 'month' ? now - 30 * 86400_000
    : 0;

  const filtered = sessions.filter((s) => new Date(s.startedAt).getTime() > cutoff);

  const devStats = useMemo(() => {
    const map: Record<string, { totalCost: number; sessionCount: number; isActive: boolean }> = {};
    for (const s of filtered) {
      const dev = s.developerId;
      if (!map[dev]) map[dev] = { totalCost: 0, sessionCount: 0, isActive: false };
      map[dev]!.totalCost += s.totalCostUsd ?? 0;
      map[dev]!.sessionCount++;
      if (s.status === 'active' && new Date(s.startedAt).getTime() > now - 30 * 60_000) {
        map[dev]!.isActive = true;
      }
    }
    return Object.entries(map).sort(([, a], [, b]) => b.totalCost - a.totalCost);
  }, [filtered, now]);

  const last7Days = daily.slice(-7);
  const getSparkline = (devId: string): number[] =>
    last7Days.map((d) => d.byDeveloper?.[devId] ?? 0);

  const glass: React.CSSProperties = {
    background: 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.06)',
    padding: 24,
  };

  return (
    <div style={{ padding: 32, background: '#0a0a0a', minHeight: '100%', color: '#fafafa' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.3px' }}>Team</h1>
          <div style={{ fontSize: 13, color: '#52525b', marginTop: 4 }}>
            {devStats.length} developer{devStats.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['week', 'month', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{ borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.08)', background: period === p ? 'rgba(255,255,255,0.10)' : 'transparent', color: period === p ? '#fafafa' : '#52525b' }}
            >
              {p === 'week' ? 'This week' : p === 'month' ? 'This month' : 'All time'}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {devStats.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 80 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>No developer activity yet</div>
          <div style={{ fontSize: 14, color: '#a1a1aa' }}>Sessions will appear here as your team runs Claude Code.</div>
        </div>
      )}

      {/* Developer cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {devStats.map(([devId, stats]) => {
          const [c1, c2] = hashDevId(devId);
          const sparkData = getSparkline(devId);
          const lastVal = sparkData[sparkData.length - 1] ?? 0;
          const firstVal = sparkData[0] ?? 0;
          const trendColor = lastVal >= firstVal ? '#fbbf24' : '#4ade80';
          const avgCost = stats.sessionCount > 0 ? stats.totalCost / stats.sessionCount : 0;

          return (
            <div key={devId} style={glass}>
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${c1}, ${c2})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 700, color: '#0a0a0a', flexShrink: 0,
                }}>
                  {devId.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#fafafa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {devId}
                  </div>
                </div>
                {stats.isActive && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80' }} />
                    <span style={{ fontSize: 11, color: '#4ade80' }}>Active</span>
                  </div>
                )}
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16, textAlign: 'center' as const }}>
                {[
                  { label: 'Cost', value: `$${stats.totalCost.toFixed(3)}`, color: '#fbbf24' },
                  { label: 'Sessions', value: String(stats.sessionCount), color: '#fafafa' },
                  { label: 'Avg cost', value: `$${avgCost.toFixed(3)}`, color: '#a1a1aa' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: 17, fontWeight: 600, color, fontFamily: 'monospace' }}>{value}</div>
                    <div style={{ fontSize: 10, color: '#52525b', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Sparkline */}
              {sparkData.some((v) => v > 0) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Sparkline data={sparkData} color={trendColor} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
