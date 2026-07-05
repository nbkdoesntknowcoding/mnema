export function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
