'use client';
// DESIGN APPLIED: 2026-05-27

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { T, glassCard } from '../../lib/dev-tokens';

interface CostSummary {
  totalCostUsd: number;
  activeSessions: number;
  byAgent: Record<string, number>;
  byDeveloper: Record<string, number>;
}

interface DailyEntry {
  date: string;
  costUsd: number;
  byAgent: Record<string, number>;
}

interface BudgetConfig {
  dailyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  alertThresholdPct: number;
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
}

const AGENT_COLORS: Record<string, string> = {
  claude_code: T.amber,
  cursor:      T.violet,
  aider:       T.green,
  cline:       '#60a5fa',
  generic:     T.textDisabled,
};

// ── Shared card style ─────────────────────────────────────────────────────────

const statCard: React.CSSProperties = {
  ...glassCard,
  padding:       '18px 18px 16px',
};

const chartCard: React.CSSProperties = {
  ...glassCard,
  padding:       '18px 18px 14px',
  minHeight:     320,
  display:       'flex',
  flexDirection: 'column',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CostDashboard() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [budget, setBudget] = useState<BudgetConfig>({ alertThresholdPct: 80 });
  const [budgetForm, setBudgetForm] = useState<BudgetConfig>({ alertThresholdPct: 80 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      const [s, d, b] = await Promise.all([
        fetch('/api/dev/cost-summary?period=today').then((r) => r.json()) as Promise<CostSummary>,
        fetch('/api/dev/cost-daily').then((r) => r.json()) as Promise<{ daily: DailyEntry[] }>,
        fetch('/api/dev/budget').then((r) => r.json()) as Promise<BudgetConfig>,
      ]);
      setSummary(s);
      setDaily(d.daily ?? []);
      setBudget(b);
      setBudgetForm(b);
    } catch { /* offline */ }
  };

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const monthlyTotal = daily.reduce((sum, d) => sum + (d.costUsd ?? 0), 0);
  const last7 = daily.slice(-7);
  const avgCost = last7.length > 0 ? last7.reduce((s, d) => s + (d.costUsd ?? 0), 0) / last7.length : 0;

  const budgetPct = budget.monthlyBudgetUsd && budget.monthlyBudgetUsd > 0
    ? Math.min(100, (monthlyTotal / budget.monthlyBudgetUsd) * 100)
    : null;

  const topDevs = Object.entries(summary?.byDeveloper ?? {}).sort(([, a], [, b]) => b - a);
  const maxDevCost = topDevs[0]?.[1] ?? 1;

  const allAgents = Array.from(new Set(daily.flatMap((d) => Object.keys(d.byAgent ?? {}))));

  const saveBudget = async () => {
    setSaving(true);
    try {
      await fetch('/api/dev/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(budgetForm),
      });
      setBudget(budgetForm);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* noop */ }
    setSaving(false);
  };

  interface TooltipEntry { name: string; value: number; color: string }
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ ...glassCard, padding: 12, fontSize: 12, minWidth: 140, fontFamily: T.fontUI }}>
        <div style={{ color: T.textMuted, marginBottom: 6, fontFamily: T.fontMono }}>{label}</div>
        {payload.map((p) => (
          <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color }}>
            <span>{p.name}</span>
            <span style={{ fontFamily: T.fontMono }}>${Number(p.value).toFixed(4)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{
      padding:    '22px 24px 32px',
      background: T.bg,
      minHeight:  '100%',
      color:      T.textPrimary,
      fontFamily: T.fontUI,
      overflowY:  'auto',
    }}>
      {/* Page header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   20,
      }}>
        <div>
          <h1 style={{
            margin:        0,
            fontSize:      16,
            fontWeight:    600,
            color:         T.textPrimary,
            letterSpacing: '-0.01em',
          }}>
            Cost
          </h1>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: T.textMuted }}>
            spend across all sessions
          </p>
        </div>
        <span style={{
          fontFamily:    T.fontMono,
          fontSize:      10,
          fontWeight:    500,
          color:         T.textMuted,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          PERIOD · LAST 30 DAYS
        </span>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────── */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap:                 14,
        marginBottom:        16,
      }}>
        {/* Today's cost */}
        <div style={statCard}>
          <div style={statLab}>Today</div>
          <div style={{ ...statVal, color: T.amber }}>
            ${(summary?.totalCostUsd ?? 0).toFixed(4)}
          </div>
        </div>

        {/* Monthly */}
        <div style={statCard}>
          <div style={statLab}>This Month</div>
          <div style={{ ...statVal, color: T.amber }}>
            ${monthlyTotal.toFixed(4)}
          </div>
          {budgetPct !== null && (
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 4, background: T.surface3, borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  height:     '100%',
                  borderRadius: 999,
                  width:      `${budgetPct}%`,
                  background: budgetPct >= 100 ? T.red : budgetPct >= 80 ? T.amber : T.green,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4, fontFamily: T.fontMono }}>
                {budgetPct.toFixed(0)}% of ${budget.monthlyBudgetUsd?.toFixed(0)} budget
              </div>
            </div>
          )}
        </div>

        {/* Active sessions */}
        <div style={statCard}>
          <div style={statLab}>Active Sessions</div>
          <div style={{ ...statVal }}>
            {summary?.activeSessions ?? 0}
          </div>
        </div>

        {/* Avg/session */}
        <div style={statCard}>
          <div style={statLab}>Avg / Session (7d)</div>
          <div style={{ ...statVal, color: T.textSecondary }}>
            ${avgCost.toFixed(4)}
          </div>
        </div>
      </div>

      {/* ── Charts ───────────────────────────────────────────────────── */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: '1.5fr 1fr',
        gap:                 14,
        marginBottom:        16,
      }}>
        {/* Daily bar chart */}
        <div style={chartCard}>
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            marginBottom:   16,
          }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: T.textPrimary }}>
              Daily cost — last 30 days
            </span>
            {/* Legend */}
            <div style={{ display: 'flex', gap: 12 }}>
              {allAgents.slice(0, 3).map((agent) => (
                <span key={agent} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: T.fontMono, fontSize: 10.5, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <i style={{ width: 8, height: 8, borderRadius: 2, background: AGENT_COLORS[agent] ?? T.textDisabled, display: 'inline-block' }} />
                  {agent}
                </span>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={daily} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => v.slice(5)}
                  interval={4}
                  style={{ fill: T.textMuted, fontSize: 10, fontFamily: T.fontMono }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  style={{ fill: T.textMuted, fontSize: 10, fontFamily: T.fontMono }}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                {allAgents.map((agent) => (
                  <Bar
                    key={agent}
                    dataKey={(d: DailyEntry) => d.byAgent?.[agent] ?? 0}
                    name={agent}
                    stackId="a"
                    fill={AGENT_COLORS[agent] ?? T.textDisabled}
                    radius={0}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* By developer */}
        <div style={chartCard}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: T.textPrimary, marginBottom: 16 }}>
            By developer
          </div>
          {topDevs.length === 0 && (
            <div style={{ color: T.textMuted, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              No data yet
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
            {topDevs.map(([dev, cost]) => (
              <div
                key={dev}
                style={{ display: 'grid', gridTemplateColumns: '28px 1fr 56px', alignItems: 'center', gap: 10 }}
              >
                {/* Avatar */}
                <span style={{
                  width:          28,
                  height:         28,
                  borderRadius:   '50%',
                  background:     `${T.amber}30`,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  fontSize:       10,
                  fontWeight:     700,
                  color:          T.amber,
                  flexShrink:     0,
                }}>
                  {dev.slice(0, 2).toUpperCase()}
                </span>

                {/* Name + bar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dev}
                  </span>
                  <div style={{ height: 6, background: T.surface3, borderRadius: 999, overflow: 'hidden' }}>
                    <span style={{
                      display:    'block',
                      height:     '100%',
                      background: `linear-gradient(90deg, ${T.amber}, ${T.amber}60)`,
                      borderRadius: 999,
                      width:      `${(cost / maxDevCost) * 100}%`,
                    }} />
                  </div>
                </div>

                {/* Amount */}
                <span style={{ textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 500, color: T.amber }}>
                  ${cost.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Budget configuration ─────────────────────────────────────── */}
      <div style={{
        ...glassCard,
        padding: '20px 20px 18px',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 500, color: T.textPrimary, fontFamily: T.fontUI }}>
          Budget configuration
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          {/* Daily budget */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={budgetLabel}>Daily budget (USD)</label>
            <div style={inputWrap}>
              <span style={inputPrefix}>$</span>
              <input
                type="number"
                value={budgetForm.dailyBudgetUsd ?? ''}
                onChange={(e) => setBudgetForm((f) => ({ ...f, dailyBudgetUsd: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="No limit"
                style={bareInput}
              />
            </div>
          </div>

          {/* Monthly budget */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={budgetLabel}>Monthly budget (USD)</label>
            <div style={inputWrap}>
              <span style={inputPrefix}>$</span>
              <input
                type="number"
                value={budgetForm.monthlyBudgetUsd ?? ''}
                onChange={(e) => setBudgetForm((f) => ({ ...f, monthlyBudgetUsd: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="No limit"
                style={bareInput}
              />
            </div>
          </div>

          {/* Alert threshold */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={budgetLabel}>Alert threshold</label>
            <div style={inputWrap}>
              <input
                type="number"
                value={budgetForm.alertThresholdPct}
                onChange={(e) => setBudgetForm((f) => ({ ...f, alertThresholdPct: Number(e.target.value) }))}
                placeholder="80"
                style={bareInput}
              />
              <span style={inputSuffix}>%</span>
            </div>
          </div>

          {/* Slack webhook */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={budgetLabel}>Slack webhook URL</label>
            <input
              type="url"
              value={budgetForm.slackWebhookUrl ?? ''}
              onChange={(e) => setBudgetForm((f) => ({ ...f, slackWebhookUrl: e.target.value || undefined }))}
              placeholder="https://hooks.slack.com/…"
              style={{
                background:    T.surface2,
                border:        `0.5px solid ${T.line}`,
                borderRadius:  6,
                padding:       '9px 12px',
                color:         T.textPrimary,
                fontFamily:    T.fontMono,
                fontSize:      12.5,
                outline:       'none',
                width:         '100%',
                boxSizing:     'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => { void saveBudget(); }}
            disabled={saving}
            style={{
              background:   T.textPrimary,
              color:        T.bg,
              border:       'none',
              borderRadius: 8,
              padding:      '8px 20px',
              fontSize:     13,
              fontWeight:   600,
              cursor:       saving ? 'wait' : 'pointer',
              opacity:      saving ? 0.6 : 1,
              fontFamily:   T.fontUI,
            }}
          >
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save budget'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-styles (defined outside component to avoid recreation) ─────────

const statLab: React.CSSProperties = {
  fontFamily:    T.fontMono,
  fontSize:      10,
  fontWeight:    500,
  color:         T.textMuted,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom:  8,
};

const statVal: React.CSSProperties = {
  fontFamily:    T.fontUI,
  fontSize:      36,
  fontWeight:    400,
  color:         T.textPrimary,
  letterSpacing: '-0.01em',
  lineHeight:    1,
  fontVariantNumeric: 'tabular-nums' as const,
};

const budgetLabel: React.CSSProperties = {
  fontFamily:    T.fontMono,
  fontSize:      10.5,
  fontWeight:    500,
  color:         T.textMuted,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const inputWrap: React.CSSProperties = {
  display:      'flex',
  alignItems:   'stretch',
  background:   T.surface2,
  border:       `0.5px solid ${T.line}`,
  borderRadius: 8,
};

const inputPrefix: React.CSSProperties = {
  display:       'inline-flex',
  alignItems:    'center',
  padding:       '0 10px',
  fontFamily:    T.fontMono,
  fontSize:      12.5,
  fontWeight:    500,
  color:         T.textMuted,
  borderRight:   `0.5px solid ${T.line}`,
  flexShrink:    0,
};

const inputSuffix: React.CSSProperties = {
  display:       'inline-flex',
  alignItems:    'center',
  padding:       '0 12px',
  fontFamily:    T.fontMono,
  fontSize:      11.5,
  fontWeight:    500,
  color:         T.textMuted,
  borderLeft:    `0.5px solid ${T.line}`,
  flexShrink:    0,
};

const bareInput: React.CSSProperties = {
  flex:       1,
  border:     0,
  outline:    0,
  background: 'transparent',
  color:      T.textPrimary,
  fontFamily: T.fontMono,
  fontSize:   13,
  fontWeight: 500,
  padding:    '10px 12px',
  minWidth:   0,
};
