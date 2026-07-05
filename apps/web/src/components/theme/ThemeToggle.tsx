import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'mnema-theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === 'light' || stored === 'dark') setTheme(stored);
    } catch {
      // private-mode browsers throw on localStorage access
    }
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY);
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
      } else {
        localStorage.setItem(STORAGE_KEY, next);
        document.documentElement.dataset.theme = next;
      }
    } catch {
      document.documentElement.dataset.theme = next === 'system' ? 'dark' : next;
    }
  }

  // Track OS preference changes while on "system"
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [theme]);

  const options: { value: Theme; Icon: typeof Monitor; label: string }[] = [
    { value: 'system', Icon: Monitor, label: 'System' },
    { value: 'light', Icon: Sun, label: 'Light' },
    { value: 'dark', Icon: Moon, label: 'Dark' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 p-0.5"
      style={{
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {options.map(({ value, Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          onClick={() => apply(value)}
          className="inline-flex items-center justify-center w-6 h-6 outline-none transition-[background,color]"
          style={{
            borderRadius: 'var(--radius-sm)',
            background: theme === value ? 'var(--surface-overlay)' : 'transparent',
            color: theme === value ? 'var(--text-primary)' : 'var(--text-tertiary)',
            boxShadow: 'none',
          }}
          onMouseOver={(e) => {
            if (theme !== value) e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          onMouseOut={(e) => {
            if (theme !== value) e.currentTarget.style.color = 'var(--text-tertiary)';
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = 'var(--focus-ring)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <Icon size={14} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
