import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Copy, Check } from 'lucide-react';

interface PreviewStep {
  step_index: number;
  node_id: string;
  title: string;
  kind: string;
  instruction: string;
  content: string;
  content_type: string;
  source: { doc_id: string; doc_title: string } | null;
}

interface PreviewResponse {
  flow_id: string;
  flow_name: string;
  version_id: string;
  is_published: boolean;
  total_steps: number;
  steps: PreviewStep[];
}

interface Props {
  flowSlug: string;
  version: 'draft' | 'published';
  onClose: () => void;
}

/** Dot colour per node kind — matches the hifi node-type accents. */
const KIND_DOT: Record<string, string> = {
  doc:         'bg-[#7c9cff]',
  docs:        'bg-[#7c9cff]',
  instruction: 'bg-[#b8bcc4]',
  decision:    'bg-[#ff7a8a]',
  capture:     'bg-[#6be39b]',
};

export function WalkSimulator({ flowSlug, version, onClose }: Props) {
  const [preview, setPreview]       = useState<PreviewResponse | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [copied, setCopied]         = useState(false);

  // ── Load preview ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/flows/${flowSlug}/preview?version=${version}`, {
      credentials: 'include',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<PreviewResponse>;
      })
      .then(setPreview)
      .catch((e: unknown) => setError(String((e as Error).message ?? e)));
  }, [flowSlug, version]);

  // ── Keyboard nav ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (!preview) return;
      if (e.key === 'ArrowRight' && currentStep < preview.steps.length - 1)
        setCurrentStep((s) => s + 1);
      if (e.key === 'ArrowLeft' && currentStep > 0)
        setCurrentStep((s) => s - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, currentStep, onClose]);

  // ── Copy step ─────────────────────────────────────────────────────────────
  function copyStep() {
    if (!preview) return;
    const step = preview.steps[currentStep];
    if (!step) return;
    const text = [
      `STEP ${step.step_index} · ${step.kind.toUpperCase()} — ${step.title}`,
      step.instruction ? `\nINSTRUCTION:\n${step.instruction}` : '',
      step.content    ? `\n${step.content}` : '',
      step.source     ? `\nsource: ${step.source.doc_title}` : '',
    ].join('');
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const totalSteps = preview?.steps.length ?? 0;

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(10,11,13,0.80)', backdropFilter: 'blur(8px) saturate(140%)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal */}
      <div
        className="w-full flex flex-col overflow-hidden"
        style={{
          maxWidth: 768,
          maxHeight: '85vh',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 30px 80px -30px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)',
          animation: 'walk-pop 220ms cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        <style>{`
          @keyframes walk-pop {
            from { opacity:0; transform: scale(0.96) translateY(8px); }
            to   { opacity:1; transform: scale(1)    translateY(0);   }
          }
        `}</style>

        {/* ── HEADER ────────────────────────────────────────────────────── */}
        <header
          className="flex items-center justify-between px-[22px]"
          style={{ height: 56, borderBottom: '1px solid var(--line)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* "WALK THIS FLOW" mono label */}
            <span
              className="font-mono text-[10px] uppercase tracking-[0.08em] shrink-0"
              style={{ color: 'var(--ink-muted)' }}
            >
              Walk this flow
            </span>

            {/* Flow name */}
            <span
              className="text-[14px] font-medium truncate"
              style={{ color: 'var(--ink)' }}
            >
              {preview?.flow_name ?? flowSlug}
            </span>

            {/* Step pill — accent (edit) tone */}
            {preview && totalSteps > 0 && (
              <span
                className="inline-flex items-center gap-1.5 px-[9px] h-5 font-mono text-[11px] font-medium tracking-[0.02em] rounded-full border shrink-0"
                style={{
                  background: 'var(--accent-soft)',
                  borderColor: 'var(--accent-line)',
                  color: 'var(--accent)',
                }}
              >
                <span className="w-[5px] h-[5px] rounded-full bg-current" />
                Step {currentStep + 1} of {totalSteps}
              </span>
            )}
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-[6px] transition-colors"
            style={{
              width: 28, height: 28,
              background: 'transparent',
              border: 'none',
              color: 'var(--ink-muted)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-muted)'; }}
            aria-label="Close walk simulator"
            title="Close · Esc"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        {/* ── PROGRESS STRIP ────────────────────────────────────────────── */}
        {preview && totalSteps > 0 && (
          <div className="flex gap-1 px-[22px] pt-2">
            {preview.steps.map((_, i) => (
              <span
                key={i}
                className="flex-1 h-[2px] rounded-[2px] transition-colors duration-200"
                style={{
                  background: i <= currentStep ? 'var(--accent)' : 'var(--surface-2)',
                }}
              />
            ))}
          </div>
        )}

        {/* ── BODY ──────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-[26px] py-[22px]">
          {error ? (
            <div
              className="flex flex-col items-center text-center py-14"
              style={{ color: 'var(--status-error)' }}
            >
              <p className="text-[13px]">Couldn't load preview</p>
              <div
                className="mt-2 font-mono text-[11px] px-3 py-2 rounded-[6px] max-w-[360px]"
                style={{
                  color: 'var(--ink-muted)',
                  background: 'var(--canvas)',
                  border: '1px solid rgba(255,122,138,0.22)',
                }}
              >
                {error}
              </div>
            </div>
          ) : !preview ? (
            <div className="flex flex-col items-center py-14 gap-3" style={{ color: 'var(--ink-muted)' }}>
              <span
                className="w-[22px] h-[22px] rounded-full border-2"
                style={{ borderColor: 'var(--line-strong)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }}
              />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <p className="text-[13px]">Loading…</p>
            </div>
          ) : totalSteps === 0 ? (
            <div className="text-center py-14" style={{ color: 'var(--ink-muted)' }}>
              <p className="text-[13px]">This flow has no steps to walk yet.</p>
            </div>
          ) : (
            <StepView step={preview.steps[currentStep]!} />
          )}
        </div>

        {/* ── FOOTER ────────────────────────────────────────────────────── */}
        {preview && totalSteps > 0 && (
          <footer
            className="flex items-center justify-between px-[22px]"
            style={{ height: 56, borderTop: '1px solid var(--line)', background: 'var(--surface)' }}
          >
            {/* Prev / Next */}
            <div className="flex gap-2">
              <FootBtn
                onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
                disabled={currentStep === 0}
              >
                <ChevronLeft size={12} strokeWidth={2.2} />
                Previous
              </FootBtn>
              <FootBtn
                onClick={() => setCurrentStep((s) => Math.min(totalSteps - 1, s + 1))}
                disabled={currentStep >= totalSteps - 1}
              >
                Next
                <ChevronRight size={12} strokeWidth={2.2} />
              </FootBtn>
            </div>

            {/* Right side: keyboard hint + copy */}
            <div className="flex items-center">
              <span
                className="font-mono text-[10px] tracking-[0.04em] flex items-center gap-1.5 mr-3"
                style={{ color: 'var(--ink-faint)' }}
              >
                <Kbd>←</Kbd><Kbd>→</Kbd>
                <span>step ·</span>
                <Kbd>Esc</Kbd>
                <span>close</span>
              </span>

              <FootBtn ghost onClick={copyStep}>
                {copied ? (
                  <>
                    <Check size={12} strokeWidth={2.5} style={{ color: 'var(--status-success)' }} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={12} strokeWidth={2} />
                    Copy step
                  </>
                )}
              </FootBtn>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StepView({ step }: { step: PreviewStep }) {
  const dotClass = KIND_DOT[step.kind.toLowerCase()] ?? 'bg-[var(--ink-faint)]';

  return (
    <div>
      {/* Eyebrow: dot + STEP 01 · KIND */}
      <div
        className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.06em] mb-2.5"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${dotClass}`} />
        Step {String(step.step_index).padStart(2, '0')} · {step.kind}
      </div>

      {/* Title */}
      <h2
        className="text-[18px] font-medium leading-[1.3] tracking-[-0.01em] mb-[18px]"
        style={{ color: 'var(--ink)' }}
      >
        {step.title}
      </h2>

      {/* Instruction callout */}
      {step.instruction && (
        <div
          className="rounded-lg p-[14px_16px] mb-5"
          style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}
        >
          <p
            className="font-mono text-[10.5px] uppercase tracking-[0.06em] mb-2"
            style={{ color: 'var(--accent)' }}
          >
            Instruction (read first)
          </p>
          <p
            className="text-[13.5px] leading-[1.6] italic m-0"
            style={{ color: 'var(--ink)' }}
          >
            {step.instruction}
          </p>
        </div>
      )}

      {/* Content */}
      {step.content && (
        <div>
          <p
            className="font-mono text-[10.5px] uppercase tracking-[0.06em] mb-2"
            style={{ color: 'var(--ink-muted)' }}
          >
            Content
          </p>
          <div
            className="text-[13.5px] leading-[1.65] whitespace-pre-wrap font-sans"
            style={{ color: 'var(--ink-soft)' }}
          >
            {step.content}
          </div>
          {step.source && (
            <p className="mt-3.5 font-mono text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              source: <span style={{ color: 'var(--ink-muted)' }}>{step.source.doc_title}</span>
            </p>
          )}
        </div>
      )}

      {/* Placeholder when no content + not instruction kind */}
      {!step.content && step.kind !== 'instruction' && (
        <p className="text-[13px] italic" style={{ color: 'var(--ink-faint)' }}>
          No content rendered for this step.
        </p>
      )}
    </div>
  );
}

/** Foot button used in prev/next and copy step */
function FootBtn({
  children,
  onClick,
  disabled,
  ghost,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ghost?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-[6px] font-medium text-[12.5px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        padding: '7px 12px',
        background: ghost ? 'transparent' : 'var(--surface-2)',
        border: ghost ? '1px solid transparent' : '1px solid var(--line)',
        color: ghost ? 'var(--ink-soft)' : 'var(--ink)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.background = ghost ? 'var(--surface-2)' : 'var(--surface-3)';
          if (ghost) (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)';
          if (!ghost) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line-strong)';
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = ghost ? 'transparent' : 'var(--surface-2)';
        if (ghost) (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-soft)';
        if (!ghost) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)';
      }}
    >
      {children}
    </button>
  );
}

/** Keyboard hint keycap */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="px-[5px] py-[2px] rounded-[3px] font-mono text-[9.5px]"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        color: 'var(--ink-muted)',
      }}
    >
      {children}
    </kbd>
  );
}
