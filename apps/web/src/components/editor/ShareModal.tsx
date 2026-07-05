import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

interface Member {
  userId: string;
  displayName: string;
  email: string;
  role: string;
}

interface ShareModalProps {
  docId: string;
  initialIsPublic: boolean;
  initialPublicToken: string | null | undefined;
  onClose: () => void;
}

const APP_ORIGIN = 'https://mnema.example.com';

export function ShareModal({
  docId,
  initialIsPublic,
  initialPublicToken,
  onClose,
}: ShareModalProps): JSX.Element {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [publicToken, setPublicToken] = useState<string | null>(initialPublicToken ?? null);
  const [toggling, setToggling] = useState(false);
  const [copyLinkLabel, setCopyLinkLabel] = useState('Copy link');

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [copiedMemberId, setCopiedMemberId] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load members
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/members', { credentials: 'include' });
        if (!res.ok) return;
        const body = (await res.json()) as { members: Member[] };
        setMembers(body.members);
      } catch {}
      setMembersLoaded(true);
    })();
  }, []);

  const togglePublic = async () => {
    setToggling(true);
    try {
      const res = await fetch(`/api/docs/${docId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enable: !isPublic }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        is_public: boolean;
        public_token: string | null;
        share_url: string | null;
      };
      setIsPublic(body.is_public);
      setPublicToken(body.public_token);
    } catch {}
    setToggling(false);
  };

  const shareUrl = publicToken ? `${APP_ORIGIN}/share/${publicToken}` : null;
  const docUrl = `${APP_ORIGIN}/app/content/${docId}`;

  const copyToClipboard = async (text: string, setter: (v: string) => void, reset: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setter('Copied!');
      setTimeout(() => setter(reset), 1800);
    } catch {}
  };

  const initials = (name: string) =>
    name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  const roleColor = (role: string) =>
    role === 'owner'
      ? 'var(--status-warning)'
      : role === 'editor'
        ? 'var(--status-info)'
        : 'var(--text-tertiary)';

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 200, background: 'rgba(0,0,0,0.45)' }}
    >
      <div
        className="flex flex-col"
        style={{
          width: 460,
          maxHeight: '80vh',
          background: 'var(--surface-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            Share document
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              fontSize: 18,
              lineHeight: 1,
              padding: '2px 4px',
              borderRadius: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          className="flex flex-col gap-5 overflow-y-auto"
          style={{ padding: '20px 20px 24px' }}
        >
          {/* Public link section */}
          <section>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Public reader link
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                  Anyone with the link can read this doc — no sign-in required.
                </p>
              </div>
              {/* Toggle */}
              <button
                type="button"
                onClick={togglePublic}
                disabled={toggling}
                aria-pressed={isPublic}
                style={{
                  width: 42,
                  height: 24,
                  borderRadius: 12,
                  background: isPublic ? 'var(--accent-primary, #6366f1)' : 'var(--border-default)',
                  border: 'none',
                  cursor: toggling ? 'wait' : 'pointer',
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background 0.18s',
                  opacity: toggling ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: isPublic ? 21 : 3,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.18s',
                  }}
                />
              </button>
            </div>

            {isPublic && shareUrl && (
              <div
                className="flex items-center gap-2"
                style={{
                  background: 'var(--surface-base)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'monospace',
                  }}
                >
                  {shareUrl}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(shareUrl, setCopyLinkLabel, 'Copy link')
                  }
                  style={{
                    flexShrink: 0,
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--accent-primary, #6366f1)',
                    color: '#fff',
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copyLinkLabel}
                </button>
              </div>
            )}

            {!isPublic && (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
                Turn on the toggle to generate a shareable read-only link.
              </p>
            )}
          </section>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border-default)' }} />

          {/* Team members section */}
          <section>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Team members
              </p>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                Can access this doc via their account
              </span>
            </div>

            {!membersLoaded ? (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading…</p>
            ) : members.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No team members found.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {members.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center gap-3"
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-base)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {/* Avatar */}
                    <div
                      className="flex items-center justify-center"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: 'var(--surface-overlay)',
                        color: 'var(--text-secondary)',
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {initials(m.displayName || m.email)}
                    </div>
                    {/* Name + email */}
                    <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.displayName || m.email}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: roleColor(m.role),
                          textTransform: 'capitalize',
                        }}
                      >
                        {m.role}
                      </span>
                    </div>
                    {/* Copy link */}
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          docUrl,
                          (v) => setCopiedMemberId(v === 'Copied!' ? m.userId : null),
                          'Copy link',
                        )
                      }
                      style={{
                        flexShrink: 0,
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'transparent',
                        color:
                          copiedMemberId === m.userId
                            ? 'var(--status-success)'
                            : 'var(--text-secondary)',
                        border: '1px solid var(--border-default)',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'color 0.15s, border-color 0.15s',
                      }}
                    >
                      {copiedMemberId === m.userId ? 'Copied!' : 'Copy link'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
