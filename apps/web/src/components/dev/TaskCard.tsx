// DESIGN APPLIED: 2026-05-27

import type { JSX } from 'react';
import { T, glassCard } from '../../lib/dev-tokens';

export interface Task {
  id: string;
  workspaceId: string;
  docId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  estimatedCostUsd: number | null;
  assignedMemberId: string | null;
  githubPrUrl: string | null;
  githubPrStatus: string | null;
  blockerDescription: string | null;
  retryCount: number;
  boardOrder: number;
  tags: string[] | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  projectName?: string;
  projectColor?: string;
  showProjectBadge?: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: T.critical,
  high:     T.high,
  medium:   T.medium,
  low:      T.low,
};

export function TaskCard({ task, isDragging, projectName, projectColor, showProjectBadge }: TaskCardProps): JSX.Element {
  const priorityColor = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium!;
  const statusColors = T.sbadge[task.status as keyof typeof T.sbadge] ?? T.sbadge.backlog;

  return (
    <div
      style={{
        ...glassCard,
        position:  'relative',
        padding:   '14px 16px 14px 19px',
        cursor:    'grab',
        opacity:   isDragging ? 0.7 : 1,
        userSelect: 'none',
        background: isDragging ? T.glassHover : T.glass,
        transition: 'opacity 0.15s ease',
        fontFamily: T.fontUI,
      }}
    >
      {/* Priority strip — replaces ::before */}
      <div
        style={{
          position:    'absolute',
          top:         12,
          bottom:      12,
          left:        8,
          width:       3,
          borderRadius: 2,
          background:  priorityColor,
          flexShrink:  0,
        }}
      />

      {/* Title */}
      <p style={{
        margin:             0,
        fontSize:           13,
        fontWeight:         500,
        color:              T.textPrimary,
        display:            '-webkit-box',
        WebkitLineClamp:    2,
        WebkitBoxOrient:    'vertical',
        overflow:           'hidden',
        lineHeight:         '1.45',
        marginBottom:       8,
      }}>
        {task.title}
      </p>

      {/* Project badge — shown when multiple projects exist */}
      {showProjectBadge && projectName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: projectColor ?? T.textMuted, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontUI, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName}</span>
        </div>
      )}

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Status badge */}
        <span style={{
          display:      'inline-flex',
          alignItems:   'center',
          padding:      '2px 7px',
          borderRadius: 6,
          fontSize:     11,
          fontWeight:   500,
          background:   statusColors.bg,
          border:       `0.5px solid ${statusColors.border}`,
          color:        statusColors.text,
          lineHeight:   '1.6',
        }}>
          {task.status.replace('_', ' ')}
        </span>

        {/* Cost */}
        {task.estimatedCostUsd != null && (
          <span style={{
            fontSize:   11,
            color:      T.textMuted,
            fontFamily: T.fontMono,
          }}>
            ${task.estimatedCostUsd.toFixed(2)}
          </span>
        )}

        {/* Linked doc indicator */}
        {task.docId && (
          <span
            title="Linked doc"
            style={{ fontSize: 11, color: T.textMuted, lineHeight: 1 }}
          >
            📄
          </span>
        )}

        {/* PR link */}
        {task.githubPrUrl && (
          <a
            href={task.githubPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize:       11,
              color:          T.accent,
              textDecoration: 'none',
              fontWeight:     500,
            }}
            title="GitHub PR"
          >
            PR ↗
          </a>
        )}

        {/* Blocker badge */}
        {task.status === 'audit_fix' && task.blockerDescription && (
          <span
            title={task.blockerDescription}
            style={{ color: T.red, fontSize: 13, lineHeight: 1 }}
          >
            ⚠
          </span>
        )}
      </div>

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize:     10,
                padding:      '2px 6px',
                borderRadius: 4,
                background:   T.glass,
                border:       `0.5px solid ${T.glassBorder}`,
                color:        T.textMuted,
                fontFamily:   T.fontMono,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
