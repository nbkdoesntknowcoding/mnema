export const PROJECT_COLORS = [
  '#f0997b', // warm orange
  '#fbbf24', // amber
  '#4ade80', // green
  '#a78bfa', // violet
  '#60a5fa', // blue
  '#f87171', // red
  '#34d399', // teal
  '#fb923c', // orange
  '#e879f9', // pink
  '#52525b', // muted (default)
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];
