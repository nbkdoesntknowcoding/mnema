'use client';

import type { JSX } from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface Datum {
  label: string;
  value: number;
}

interface Props {
  data: Datum[];
  height?: number;
  /** Index of the bar to emphasize (uses --chart-primary). Others use --chart-tertiary. */
  emphasize?: number;
}

/**
 * Minimal vertical bar chart — Recharts wrapper locked to the Mnema palette.
 *
 * Deliberately: no grid lines, no Y-axis numerics, no tooltip styling drama.
 * The data IS the chart.
 *
 * Reference: "Liquidity Labyrinth" bar chart in the 4.5.1 design reference.
 *
 * NOTE: This component uses Recharts (browser-only). When used in Astro pages
 * it must have `client:load` or `client:visible`.
 *
 * Phase 4.5.1.
 */
export function BarChart({ data, height = 140, emphasize }: Props): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 0, bottom: 4, left: 0 }}>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{
            fontFamily: 'Geist Mono, monospace',
            fontSize: 10,
            fill: 'var(--chart-label)',
          }}
        />
        <YAxis hide />
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={i === emphasize ? 'var(--chart-primary)' : 'var(--chart-tertiary)'}
            />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
