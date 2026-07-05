import { useState } from 'react';

type DocType = 'doc' | 'engineering' | 'instruction' | 'snippet';

interface DocMeta {
  id: string;
  title: string;
  type: DocType;
  status: 'published' | 'draft';
  createdBy?: string;
  lastEditBy?: string;
  lastEditAt?: string;
  createdAt?: string;
  wordCount?: number;
  blockCount?: number;
}

interface Props {
  doc: DocMeta;
  onClose: () => void;
  onTypeChange?: (type: DocType) => void;
  onStatusChange?: (published: boolean) => void;
  onDelete?: () => void;
}

const TYPE_OPTIONS: { type: DocType; name: string; desc: string }[] = [
  { type: 'doc', name: 'Doc', desc: 'General-purpose markdown.' },
  { type: 'engineering', name: 'Engineering', desc: 'Technical reference with code highlighting.' },
  { type: 'instruction', name: 'Instruction', desc: 'Tell Claude how to behave, no body.' },
  { type: 'snippet', name: 'Snippet', desc: 'Short, reusable block.' },
];

function Avatar({ initials, gradient }: { initials: string; gradient: string }) {
  return (
    <span style={{ width: 16, height: 16, borderRadius: '50%', background: gradient, color: 'white', font: '700 9px/1 var(--sans)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials}
    </span>
  );
}

function SectionLabel({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      font: '500 10.5px/1 var(--mono)', letterSpacing: '0.06em',
      textTransform: 'uppercase', color: danger ? 'var(--status-error)' : 'var(--ink-muted)',
      marginBottom: 10,
    }}>
      {children}
      <span style={{ flex: 1, height: 1, background: danger ? 'rgba(255,122,138,0.22)' : 'var(--line)' }}></span>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 32, height: 18, borderRadius: 999, cursor: 'pointer', position: 'relative',
        flexShrink: 0, border: `1px solid ${on ? 'var(--accent)' : 'var(--line-strong)'}`,
        background: on ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
        transition: 'background 140ms, border-color 140ms',
      }}
    >
      <span style={{
        position: 'absolute', left: 2, top: 2, width: 12, height: 12,
        borderRadius: '50%', background: on ? 'var(--on-ink)' : 'var(--ink-soft)',
        transition: 'transform 140ms ease, background 140ms ease',
        transform: on ? 'translateX(14px)' : 'translateX(0)',
        display: 'block',
      }} />
    </div>
  );
}

export function DocSettingsPanel({ doc, onClose, onTypeChange, onStatusChange, onDelete }: Props) {
  const [selectedType, setSelectedType] = useState<DocType>(doc.type);
  const [published, setPublished] = useState(doc.status === 'published');
  const [showTemplatePrompt, setShowTemplatePrompt] = useState(false);
  const [linkEnabled, setLinkEnabled] = useState(false);
  const [copyLinkLabel, setCopyLinkLabel] = useState('Copy');

  const handleTypeClick = (type: DocType) => {
    setSelectedType(type);
    setShowTemplatePrompt(type === 'engineering');
    onTypeChange?.(type);
  };

  const handlePublishedToggle = () => {
    const next = !published;
    setPublished(next);
    onStatusChange?.(next);
  };

  const handleCopyLink = () => {
    const url = `https://mnema.app/p/workspace/${doc.id}`;
    try { navigator.clipboard.writeText(url); } catch {}
    setCopyLinkLabel('Copied');
    setTimeout(() => setCopyLinkLabel('Copy'), 1500);
  };

  const drawerStyle: React.CSSProperties = {
    position: 'fixed', top: 'var(--topbar-h, 44px)', right: 0, bottom: 0,
    width: 360, background: 'var(--surface)',
    borderLeft: '1px solid var(--line)',
    boxShadow: '-16px 0 40px -16px rgba(0,0,0,0.5)',
    zIndex: 41, display: 'flex', flexDirection: 'column',
  };

  return (
    <>
      <style>{`
        .dsp-type-card {
          display: flex; flex-direction: column; gap: 3px;
          padding: 10px 12px; border-radius: 7px;
          background: var(--surface-2); border: 1px solid var(--line);
          cursor: pointer; text-align: left; position: relative;
        }
        .dsp-type-card:hover { border-color: var(--line-strong); }
        .dsp-type-card.selected { background: var(--accent-soft); border-color: var(--accent-line); }
        .dsp-share-row {
          padding: 11px 14px; background: var(--surface-2);
          border: 1px solid var(--line); border-radius: 7px;
          display: flex; align-items: center; gap: 10px;
        }
        .dsp-toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 11px 14px; background: var(--surface-2);
          border: 1px solid var(--line); border-radius: 7px;
        }
        .dsp-meta-rows { background: var(--surface-2); border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
        .dsp-meta-row {
          display: grid; grid-template-columns: 100px 1fr;
          padding: 9px 14px; border-top: 1px solid var(--line);
          font: 400 12.5px/1.4 var(--sans); gap: 10px; align-items: center;
        }
        .dsp-meta-row:first-child { border-top: 0; }
        .dsp-meta-key { font: 500 10.5px/1.3 var(--mono); color: var(--ink-muted); letter-spacing: 0.04em; text-transform: uppercase; }
        .dsp-meta-val { color: var(--ink); min-width: 0; display: flex; align-items: center; gap: 6px; }
        .dsp-code-chip { font: 500 11.5px/1 var(--mono); padding: 3px 7px; background: var(--sunken); border: 1px solid var(--line); border-radius: 4px; color: var(--ink); }
        .dsp-trash-btn {
          display: flex; align-items: center; gap: 8px; width: 100%;
          padding: 10px 12px; background: transparent;
          border: 1px solid rgba(255,122,138,0.30); border-radius: 7px;
          color: var(--status-error); font: 500 13px var(--sans); cursor: pointer;
        }
        .dsp-trash-btn:hover { background: rgba(255,122,138,0.10); }
        .dsp-add-member {
          display: inline-flex; align-items: center; gap: 6px;
          margin-top: 8px; font: 500 12px var(--sans); color: var(--ink-soft);
          background: transparent; border: 0; cursor: pointer; padding: 6px 0;
        }
        .dsp-add-member:hover { color: var(--ink); }
        .dsp-soon { font: 500 9.5px/1 var(--mono); padding: 2px 5px; border-radius: 3px; background: var(--surface-3); border: 1px solid var(--line); color: var(--ink-muted); letter-spacing: 0.04em; margin-left: 5px; }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', top: 'var(--topbar-h, 44px)', left: 0, right: 0, bottom: 0, background: 'rgba(10,11,13,0.30)', zIndex: 40 }}
      />

      {/* Drawer */}
      <aside style={drawerStyle}>

        {/* Head */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ font: '500 11px/1 var(--mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink)' }}>DOC SETTINGS</span>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 5, background: 'transparent', border: 0, color: 'var(--ink-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* TYPE */}
          <div>
            <SectionLabel>TYPE</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {TYPE_OPTIONS.map(({ type, name, desc }) => (
                <button key={type} className={`dsp-type-card${selectedType === type ? ' selected' : ''}`} onClick={() => handleTypeClick(type)}>
                  <span style={{ font: '500 12.5px/1 var(--sans)', color: 'var(--ink)' }}>{name}</span>
                  <span style={{ font: '400 11.5px/1.4 var(--sans)', color: selectedType === type ? 'var(--ink-soft)' : 'var(--ink-muted)' }}>{desc}</span>
                </button>
              ))}
            </div>
            {showTemplatePrompt && (
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--accent-line)', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ font: '400 12.5px/1.4 var(--sans)', color: 'var(--ink-soft)', flex: 1 }}>
                  <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>Apply engineering template?</strong> Adds a code-aware layout with frontmatter.
                </span>
                <button style={{ font: '500 11.5px/1 var(--sans)', padding: '5px 9px', borderRadius: 5, border: 0, background: 'var(--ink)', color: 'var(--on-ink)', cursor: 'pointer' }}>Apply</button>
                <button onClick={() => setShowTemplatePrompt(false)} style={{ font: '500 11.5px/1 var(--sans)', padding: '5px 9px', borderRadius: 5, border: '1px solid transparent', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer' }}>×</button>
              </div>
            )}
          </div>

          {/* STATUS */}
          <div>
            <SectionLabel>STATUS</SectionLabel>
            <div className="dsp-toggle-row">
              <div>
                <div style={{ font: '500 13px/1.3 var(--sans)', color: 'var(--ink)' }}>Published</div>
                <div style={{ font: '400 11.5px/1.3 var(--sans)', color: 'var(--ink-muted)', marginTop: 2 }}>Visible to MCP and Claude</div>
              </div>
              <Toggle on={published} onClick={handlePublishedToggle} />
            </div>
            <p style={{ marginTop: 8, font: '400 11.5px/1.4 var(--sans)', color: 'var(--ink-muted)' }}>
              Drafts can be edited but Claude can't read them.
            </p>
          </div>

          {/* SHARING */}
          <div>
            <SectionLabel>SHARING</SectionLabel>
            <div className="dsp-share-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: '500 13px/1.3 var(--sans)', color: 'var(--ink)' }}>Workspace editors</div>
                <div style={{ font: '400 11.5px/1.3 var(--sans)', color: 'var(--ink-muted)', marginTop: 2 }}>All members can view.</div>
              </div>
              <div style={{ display: 'inline-flex' }}>
                {[
                  { init: 'K', grad: 'linear-gradient(135deg,#FFB370,#FF7A8A)' },
                  { init: 'A', grad: 'linear-gradient(135deg,#7C9CFF,#C8A2FF)' },
                  { init: 'M', grad: 'linear-gradient(135deg,#6BE39B,#2B9B9B)' },
                ].map((av, i) => (
                  <span key={i} style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--surface-2)', font: '700 9.5px/1 var(--sans)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: i === 0 ? 0 : -6, background: av.grad }}>
                    {av.init}
                  </span>
                ))}
              </div>
            </div>
            <button className="dsp-add-member">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Share with specific members<span className="dsp-soon">SOON</span>
            </button>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 14px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ font: '500 13px var(--sans)', color: 'var(--ink)' }}>Anyone with the link can view</div>
                  <div style={{ font: '400 11.5px/1.3 var(--sans)', color: 'var(--ink-muted)', marginTop: 2 }}>Public link, no sign-in required.</div>
                </div>
                <Toggle on={linkEnabled} onClick={() => setLinkEnabled(!linkEnabled)} />
              </div>
              {linkEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: 'var(--sunken)', border: '1px solid var(--line)', borderRadius: 6 }}>
                  <span style={{ flex: 1, minWidth: 0, font: '500 11.5px/1 var(--mono)', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    https://mnema.app/p/workspace/{doc.id}
                  </span>
                  <button onClick={handleCopyLink} style={{ font: '500 11px var(--sans)', padding: '4px 8px', borderRadius: 4, background: 'transparent', border: '1px solid var(--line)', color: copyLinkLabel === 'Copied' ? 'var(--status-sync)' : 'var(--ink-soft)', cursor: 'pointer' }}>
                    {copyLinkLabel}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* METADATA */}
          <div>
            <SectionLabel>METADATA</SectionLabel>
            <div className="dsp-meta-rows">
              {doc.createdBy && (
                <div className="dsp-meta-row">
                  <span className="dsp-meta-key">CREATED BY</span>
                  <span className="dsp-meta-val">
                    <Avatar initials={(doc.createdBy[0] ?? 'U').toUpperCase()} gradient="linear-gradient(135deg,#FFB370,#FF7A8A)" />
                    {doc.createdBy}
                    {doc.createdAt && <span style={{ color: 'var(--ink-muted)', font: '500 11px var(--mono)' }}>{doc.createdAt}</span>}
                  </span>
                </div>
              )}
              {doc.lastEditBy && (
                <div className="dsp-meta-row">
                  <span className="dsp-meta-key">LAST EDIT</span>
                  <span className="dsp-meta-val">
                    <Avatar initials={(doc.lastEditBy[0] ?? 'U').toUpperCase()} gradient="linear-gradient(135deg,#6BE39B,#2B9B9B)" />
                    {doc.lastEditBy}
                    {doc.lastEditAt && <span style={{ color: 'var(--ink-muted)', font: '500 11px var(--mono)' }}>{doc.lastEditAt}</span>}
                  </span>
                </div>
              )}
              <div className="dsp-meta-row">
                <span className="dsp-meta-key">DOC ID</span>
                <span className="dsp-meta-val"><span className="dsp-code-chip">{doc.id}</span></span>
              </div>
              {(doc.wordCount !== undefined || doc.blockCount !== undefined) && (
                <div className="dsp-meta-row">
                  <span className="dsp-meta-key">WORD COUNT</span>
                  <span className="dsp-meta-val">
                    {doc.wordCount !== undefined && `${doc.wordCount} words`}
                    {doc.wordCount !== undefined && doc.blockCount !== undefined && ' · '}
                    {doc.blockCount !== undefined && `${doc.blockCount} blocks`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* DANGER ZONE */}
          <div style={{ marginTop: 6, paddingTop: 18, borderTop: '1px solid rgba(255,122,138,0.22)' }}>
            <SectionLabel danger>DANGER ZONE</SectionLabel>
            <button className="dsp-trash-btn" onClick={onDelete}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Move to trash
            </button>
          </div>

        </div>
      </aside>
    </>
  );
}
