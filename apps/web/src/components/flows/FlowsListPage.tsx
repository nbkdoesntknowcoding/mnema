import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill';
import { MonoLabel } from '../ui/typography';
import { WalkSimulator } from './WalkSimulator';

interface FlowSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_published: boolean;
  has_unpublished_changes: boolean;
  step_count: number;
}

interface Props {
  flows: FlowSummary[];
}

export function FlowsListPage({ flows }: Props) {
  const [walkSlug, setWalkSlug] = useState<string | null>(null);

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <h1
          style={{
            fontSize: '28px',
            lineHeight: '1.3',
            letterSpacing: '-0.01em',
            fontWeight: 500,
            color: 'var(--text-primary)',
          }}
        >
          Flows
        </h1>
      </div>
      <p
        style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '32px' }}
      >
        {flows.length} flow{flows.length !== 1 ? 's' : ''} in your workspace
      </p>

      {flows.length === 0 ? (
        <div
          className="flex items-center justify-center"
          style={{ height: '40vh' }}
        >
          <div className="text-center">
            <p
              className="font-mono uppercase mb-2"
              style={{ fontSize: '11px', letterSpacing: '0.08em', color: 'var(--text-tertiary)' }}
            >
              No flows yet
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
              Flow creation ships in Phase 6.3.
            </p>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {flows.map((flow) => (
            <li key={flow.id}>
              <a
                href={`/app/flows/${flow.slug}`}
                className="group flex items-center justify-between p-4 rounded-[var(--radius-md)] bg-[var(--surface-overlay)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--surface-elevated)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div
                    style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}
                  >
                    {flow.name}
                  </div>
                  {flow.description && (
                    <div
                      className="truncate mt-0.5"
                      style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}
                    >
                      {flow.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-6 shrink-0">
                  <MonoLabel>{flow.step_count} steps</MonoLabel>
                  {flow.has_unpublished_changes && (
                    <StatusPill tone="warning">Draft changes</StatusPill>
                  )}
                  {flow.is_published && <StatusPill tone="success">Published</StatusPill>}
                  {flow.is_published && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setWalkSlug(flow.slug);
                      }}
                      className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Walk →
                    </button>
                  )}
                  <ArrowRight
                    size={14}
                    className="text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      {walkSlug && (
        <WalkSimulator
          flowSlug={walkSlug}
          version="published"
          onClose={() => setWalkSlug(null)}
        />
      )}
    </>
  );
}
