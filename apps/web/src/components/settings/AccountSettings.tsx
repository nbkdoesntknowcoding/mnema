import { type JSX } from 'react';
import { ThemeToggle } from '../theme/ThemeToggle';

interface Props {
  email: string;
  displayName: string | null;
}

/**
 * Settings → Account.
 *
 * Phase 4.1: read-only display name + email (WorkOS owns those).
 * Phase 4.3: + a Theme preference picker (system / light / dark).
 *
 * Display name and email live in WorkOS — to change either, the user
 * manages it in their WorkOS account profile. Phase D may add a
 * "Manage your WorkOS profile" link once we know the URL pattern for
 * the AuthKit-hosted account page.
 */
export function AccountSettings({ email, displayName }: Props): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <label
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          Display name
        </label>
        <div
          className="w-full h-9 px-3 rounded-md text-sm flex items-center"
          style={{
            background: 'var(--surface-overlay)',
            color: displayName ? 'var(--text-primary)' : 'var(--text-tertiary)',
            border: '1px solid var(--border-default)',
          }}
        >
          {displayName || 'Not set'}
        </div>
      </div>

      <div>
        <label
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          Email
        </label>
        <div
          className="w-full h-9 px-3 rounded-md text-sm flex items-center"
          style={{
            background: 'var(--surface-overlay)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        >
          {email}
        </div>
      </div>

      <p
        className="text-xs pt-4"
        style={{
          color: 'var(--text-tertiary)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        Your display name and email are managed by your identity provider
        (WorkOS AuthKit) and can't be changed here. To update them, sign
        out and update your account at the provider.
      </p>

      <div className="pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <label
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          Theme
        </label>
        <p
          className="text-xs mb-3"
          style={{ color: 'var(--text-tertiary)' }}
        >
          System follows your OS preference. Light and dark override it for
          this device.
        </p>
        <ThemeToggle />
      </div>
    </div>
  );
}
