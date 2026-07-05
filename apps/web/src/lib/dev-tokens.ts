/**
 * Design tokens for AgentLens (dev_ workspace) components.
 * Source of truth: /dev/Kanban.html `:root` block.
 * All 5 HTML design files share identical token values.
 *
 * Rules:
 *   - Use T.* for ALL colours — never hardcode hex/rgba inline.
 *   - Use glassCard / glassCardHighlight for card surfaces.
 *   - Inline styles ONLY — no Tailwind, no CSS modules.
 */

import type { CSSProperties } from 'react';

export const T = {
  // ── Backgrounds ────────────────────────────────────────────────
  bg:       '#0A0B0D',   // --canvas
  surface1: '#121317',   // --surface
  surface2: '#181A1F',   // --surface-2
  surface3: '#22252B',   // --surface-3

  // ── Text ───────────────────────────────────────────────────────
  textPrimary:   '#F4F5F7',  // --ink
  textSecondary: '#B0B4BC',  // --ink-soft
  textMuted:     '#707479',  // --ink-muted
  textDisabled:  '#3D4046',  // --ink-faint

  // ── Accent ─────────────────────────────────────────────────────
  accent: '#FFB370',  // rgb(255,179,112)

  // ── Status colours ─────────────────────────────────────────────
  amber:  '#fbbf24',  // --st-amber
  violet: '#a78bfa',  // --st-purple
  red:    '#f87171',  // --st-red
  green:  '#4ade80',  // --st-green

  // ── Priority colours ───────────────────────────────────────────
  critical: '#ef4444',  // --prio-crit
  high:     '#f97316',  // --prio-high
  medium:   '#fbbf24',  // --prio-med
  low:      '#a1a1aa',  // --prio-low

  // ── Borders / Glass ────────────────────────────────────────────
  line:              'rgba(255,255,255,0.05)',
  glassBorder:       'rgba(255,255,255,0.10)',  // --line-strong
  glassBorderStrong: 'rgba(255,255,255,0.20)',  // --line-bright
  glass:             'rgba(255,255,255,0.04)',
  glassHover:        'rgba(255,255,255,0.07)',

  // ── Typography ─────────────────────────────────────────────────
  fontUI:      '"Geist", ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontMono:    '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontDisplay: '"Instrument Serif", Georgia, serif',

  // ── Status badge colour sets ────────────────────────────────────
  // Used by TaskCard and SessionsList status badges (.sbadge pattern)
  sbadge: {
    backlog:     { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)', text: '#a1a1aa' },
    in_progress: { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.22)',   text: '#fbbf24' },
    review:      { bg: 'rgba(139,92,246,0.10)',  border: 'rgba(139,92,246,0.22)',  text: '#a78bfa' },
    audit_fix:   { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.22)',   text: '#f87171' },
    done:        { bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.18)',   text: '#4ade80' },
    // Session statuses
    active:      { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.22)',   text: '#fbbf24' },
    completed:   { bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.18)',   text: '#4ade80' },
    error:       { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.22)',   text: '#f87171' },
    idle:        { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)', text: '#a1a1aa' },
  },

  // ── Amber-highlight variant (optimization rules) ────────────────
  stAmberBg:   'rgba(251,191,36,0.08)',
  stAmberBr:   'rgba(251,191,36,0.20)',
  stPurpleBg:  'rgba(167,139,250,0.08)',
  stPurpleBr:  'rgba(167,139,250,0.20)',
  stRedBg:     'rgba(248,113,113,0.08)',
  stRedBr:     'rgba(248,113,113,0.20)',
  stGreenBg:   'rgba(74,222,128,0.08)',
  stGreenBr:   'rgba(74,222,128,0.20)',
} as const;

// ── Glass card helpers ─────────────────────────────────────────────────────

/** Standard glass card surface */
export const glassCard: CSSProperties = {
  background:           T.glass,
  backdropFilter:       'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  border:               `0.5px solid ${T.glassBorder}`,
  borderRadius:         '16px',
};

/** Elevated / hovered glass card */
export const glassCardHighlight: CSSProperties = {
  ...glassCard,
  background: T.glassHover,
  border:     `0.5px solid ${T.glassBorderStrong}`,
  boxShadow:  `0 0 0 1px rgba(255,255,255,0.06), 0 -1px 0 0 rgba(255,255,255,0.12)`,
};

// ── Shared text-style helpers ──────────────────────────────────────────────

export const monoSm: CSSProperties = {
  fontFamily: T.fontMono,
  fontSize:   '11px',
  lineHeight: '1.4',
};

export const labelStyle: CSSProperties = {
  fontFamily:    T.fontUI,
  fontSize:      '11px',
  fontWeight:    500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color:         T.textMuted,
};
