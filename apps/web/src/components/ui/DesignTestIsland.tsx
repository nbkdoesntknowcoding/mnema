import { useState } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import { Textarea } from './Textarea';
import { Select } from './Select';
import { StatusPill } from './StatusPill';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Modal } from './Modal';
import { MonoLabel, PageHeading, SectionHeading, MetaText } from './typography';
import { FileText, Layers, Zap } from 'lucide-react';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: '1px solid var(--line)', paddingTop: '40px', marginBottom: '40px' }}>
      <p style={{ fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: '24px' }}>{title}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' }}>
        {children}
      </div>
    </section>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100px' }}>
      <div style={{ height: '48px', borderRadius: 'var(--r-3)', background: value, border: '1px solid var(--line)' }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-muted)', letterSpacing: '0.02em' }}>{name}</span>
    </div>
  );
}

export default function DesignTestIsland() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [modalOpen, setModalOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas)', color: 'var(--ink)', fontFamily: 'var(--sans)', padding: '48px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '48px' }}>
        <div>
          <MonoLabel style={{ display: 'block', marginBottom: '12px' }}>MNEMA · DESIGN SYSTEM v2.0</MonoLabel>
          <PageHeading>Design Token Test</PageHeading>
          <MetaText style={{ marginTop: '8px' }}>
            Verification page for Chunk 1 — dark and light mode, all primitives.
          </MetaText>
        </div>
        <Button variant="secondary" size="sm" onClick={toggleTheme}>
          Toggle theme: {theme}
        </Button>
      </div>

      {/* Color swatches */}
      <Section title="Surfaces + Lines">
        <Swatch name="--canvas" value="var(--canvas)" />
        <Swatch name="--surface" value="var(--surface)" />
        <Swatch name="--surface-2" value="var(--surface-2)" />
        <Swatch name="--surface-3" value="var(--surface-3)" />
        <Swatch name="--line" value="var(--line)" />
        <Swatch name="--line-strong" value="var(--line-strong)" />
        <Swatch name="--line-bright" value="var(--line-bright)" />
      </Section>

      <Section title="Ink">
        <Swatch name="--ink" value="var(--ink)" />
        <Swatch name="--ink-soft" value="var(--ink-soft)" />
        <Swatch name="--ink-muted" value="var(--ink-muted)" />
        <Swatch name="--ink-faint" value="var(--ink-faint)" />
        <Swatch name="--on-ink" value="var(--on-ink)" />
      </Section>

      <Section title="Accent + Status">
        <Swatch name="--accent" value="var(--accent)" />
        <Swatch name="--accent-soft" value="var(--accent-soft)" />
        <Swatch name="--accent-line" value="var(--accent-line)" />
        <Swatch name="--status-sync" value="var(--status-sync)" />
        <Swatch name="--status-edit" value="var(--status-edit)" />
        <Swatch name="--status-info" value="var(--status-info-color)" />
        <Swatch name="--status-warn" value="var(--status-warn)" />
      </Section>

      {/* Buttons */}
      <Section title="Button — Variants">
        <Button variant="primary">Primary</Button>
        <Button variant="ink">Ink</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </Section>

      <Section title="Button — Sizes">
        <Button variant="primary" size="sm">Small</Button>
        <Button variant="primary" size="md">Medium</Button>
        <Button variant="primary" size="lg">Large</Button>
        <Button variant="secondary" size="icon">
          <Zap size={15} strokeWidth={1.75} />
        </Button>
      </Section>

      {/* Inputs */}
      <Section title="Input + Textarea + Select">
        <div style={{ width: '240px' }}>
          <Input placeholder="Normal input" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
        </div>
        <div style={{ width: '240px' }}>
          <Input placeholder="Invalid state" invalid />
        </div>
        <div style={{ width: '240px' }}>
          <Textarea placeholder="Textarea..." rows={3} />
        </div>
        <div style={{ width: '200px' }}>
          <Select>
            <option>Option A</option>
            <option>Option B</option>
            <option>Option C</option>
          </Select>
        </div>
      </Section>

      {/* StatusPill */}
      <Section title="StatusPill — Tones">
        <StatusPill tone="success">Success</StatusPill>
        <StatusPill tone="sync">Sync</StatusPill>
        <StatusPill tone="warning">Warning</StatusPill>
        <StatusPill tone="edit">Published</StatusPill>
        <StatusPill tone="error">Error</StatusPill>
        <StatusPill tone="info">Info</StatusPill>
        <StatusPill tone="neutral">Neutral</StatusPill>
      </Section>

      {/* Skeleton */}
      <Section title="Skeleton">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-24" />
      </Section>

      {/* Typography */}
      <Section title="Typography">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
          <PageHeading>Page Heading</PageHeading>
          <SectionHeading>Section Heading</SectionHeading>
          <MetaText>Meta text — tertiary body copy</MetaText>
          <MonoLabel>Mono label · uppercase · tracked</MonoLabel>
        </div>
      </Section>

      {/* Empty State */}
      <Section title="EmptyState">
        <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-4)', width: '360px' }}>
          <EmptyState
            icon={<FileText size={28} strokeWidth={1.25} />}
            title="No documents yet"
            description="Create your first document to get started."
            action={<Button variant="secondary" size="sm"><Layers size={13} strokeWidth={1.75} />New document</Button>}
          />
        </div>
      </Section>

      {/* Modal */}
      <Section title="Modal">
        <Button variant="secondary" onClick={() => setModalOpen(true)}>Open modal</Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Example modal"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => setModalOpen(false)}>Confirm</Button>
            </>
          }
        >
          <p style={{ color: 'var(--ink-soft)', fontSize: '14px', lineHeight: '1.6', margin: 0 }}>
            This is the modal body. It uses the design system surface tokens, border tokens, and shadow tokens.
            The backdrop is blurred. Esc closes it.
          </p>
        </Modal>
      </Section>

      {/* Radii showcase */}
      <Section title="Radii">
        {(['--r-1','--r-2','--r-3','--r-4','--r-5','--r-6','--r-pill'] as const).map((r) => (
          <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
            <div style={{ width: '48px', height: '48px', background: 'var(--surface-2)', border: '1px solid var(--line-strong)', borderRadius: `var(${r})` }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-muted)' }}>{r}</span>
          </div>
        ))}
      </Section>

      {/* Token compat check */}
      <Section title="Backward-compat aliases">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--ink-soft)', width: '100%' }}>
          <span>--surface-base → <span style={{ background: 'var(--surface-base)', color: 'var(--text-inverse)', padding: '2px 8px', borderRadius: '4px' }}>surface-base</span></span>
          <span>--text-primary → <span style={{ color: 'var(--text-primary)' }}>text-primary</span></span>
          <span>--text-tertiary → <span style={{ color: 'var(--text-tertiary)' }}>text-tertiary</span></span>
          <span>--border-default → <span style={{ border: '1px solid var(--border-default)', padding: '2px 8px', borderRadius: '4px' }}>border-default</span></span>
          <span>--interactive-primary → <span style={{ background: 'var(--interactive-primary)', color: 'var(--interactive-primary-fg)', padding: '2px 8px', borderRadius: '4px' }}>interactive-primary</span></span>
        </div>
      </Section>
    </div>
  );
}
