import { type JSX } from 'react';

interface Props {
  /** The current URL pathname — used to highlight the active link. */
  currentPath: string;
}

interface Item {
  href: string;
  label: string;
}

const ITEMS: ReadonlyArray<Item> = [
  { href: '/app/settings/members', label: 'Members' },
  { href: '/app/settings/workspace', label: 'Workspace' },
  { href: '/app/settings/account', label: 'Account' },
  { href: '/app/settings/billing', label: 'Billing' },
  { href: '/app/settings/api-keys', label: 'API Keys' },
  { href: '/app/settings/connect-apps', label: 'Connect Apps' },
  { href: '/app/settings/byok', label: 'Meeting AI' },
];

/**
 * Left-rail nav for the settings shell. Pure presentation — Astro renders
 * the active state server-side via the `currentPath` prop so there's no
 * client-side flash of an inactive nav before React hydrates.
 */
export function SettingsNav({ currentPath }: Props): JSX.Element {
  return (
    <nav className="space-y-1">
      {ITEMS.map((item) => {
        const isActive =
          currentPath === item.href || currentPath.startsWith(`${item.href}/`);
        return (
          <a
            key={item.href}
            href={item.href}
            className="block px-3 py-1.5 text-sm rounded-md transition-colors"
            style={{
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive ? 'var(--surface-elevated)' : 'transparent',
            }}
            onMouseOver={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'var(--interactive-ghost-hover)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }
            }}
            onMouseOut={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }
            }}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
