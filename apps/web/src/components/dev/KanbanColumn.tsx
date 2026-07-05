// DESIGN APPLIED: 2026-05-27

import type { JSX } from 'react';
import { T } from '../../lib/dev-tokens';
import { TaskCard, type Task } from './TaskCard';

/** Extract the sprint name from a task's tags (strips the "sprint:" prefix). */
function getSprintName(task: Task): string | null {
  const tag = task.tags?.find((t) => t.startsWith('sprint:'));
  return tag ? tag.slice('sprint:'.length) : null;
}

/**
 * Group an already-ordered task list into { sprint, tasks } segments,
 * preserving boardOrder within each group and the order sprints first appear.
 */
function groupBySprint(
  tasks: Task[],
): { sprint: string | null; tasks: Task[] }[] {
  const seen = new Map<string | null, Task[]>();
  const order: (string | null)[] = [];
  for (const task of tasks) {
    const s = getSprintName(task);
    if (!seen.has(s)) { seen.set(s, []); order.push(s); }
    seen.get(s)!.push(task);
  }
  return order.map((s) => ({ sprint: s, tasks: seen.get(s)! }));
}

interface ProjectInfo { id: string; name: string; color: string; }

interface KanbanColumnProps {
  id: string;
  label: string;
  color: string;
  tasks: Task[];
  onTaskDrop: (taskId: string, targetStatus: string, targetIndex: number) => void;
  onAddTask?: () => void;
  onTaskClick?: (task: Task) => void;
  projectById?: Record<string, ProjectInfo>;
  showProjectBadges?: boolean;
}

export function KanbanColumn({
  id,
  label,
  color,
  tasks,
  onTaskDrop,
  onAddTask,
  onTaskClick,
  projectById = {},
  showProjectBadges = false,
}: KanbanColumnProps): JSX.Element {
  const groups = groupBySprint(tasks);

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      onTaskDrop(taskId, id, tasks.length);
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        minHeight:     200,
        fontFamily:    T.fontUI,
      }}
    >
      {/* Column header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   12,
        paddingLeft:    2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {/* Colour dot */}
          <span style={{
            width:       7,
            height:      7,
            borderRadius: '50%',
            background:  color,
            flexShrink:  0,
            boxShadow:   `0 0 6px ${color}80`,
          }} />
          {/* Label */}
          <span style={{
            fontSize:      11,
            fontWeight:    600,
            color:         T.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
          }}>
            {label}
          </span>
          {/* Count */}
          <span style={{
            fontSize:     11,
            color:        T.textDisabled,
            fontFamily:   T.fontMono,
          }}>
            {tasks.length}
          </span>
        </div>

        {/* Add button — backlog only */}
        {id === 'backlog' && onAddTask && (
          <button
            onClick={onAddTask}
            style={{
              width:          22,
              height:         22,
              borderRadius:   6,
              border:         `0.5px solid ${T.glassBorder}`,
              background:     T.glass,
              color:          T.textMuted,
              cursor:         'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              fontSize:       16,
              lineHeight:     1,
              flexShrink:     0,
            }}
            title="Add task"
          >
            +
          </button>
        )}
      </div>

      {/* Task cards list — grouped by sprint when tags are present */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, overflowY: 'auto', paddingRight: 2 }}>
        {tasks.length === 0 ? (
          <div style={{
            border:      `1px dashed ${T.glassBorder}`,
            borderRadius: 12,
            padding:     '18px 12px',
            textAlign:   'center',
            color:       T.textDisabled,
            fontSize:    12,
            background:  'rgba(255,255,255,0.01)',
          }}>
            Drop here
          </div>
        ) : (
          groups.map(({ sprint, tasks: groupTasks }, groupIdx) => (
            <div key={sprint ?? '__unspringed__'} style={{ marginBottom: groupIdx < groups.length - 1 ? 16 : 0 }}>

              {/* Sprint header divider — only when the group has a name */}
              {sprint && (
                <div style={{
                  display:       'flex',
                  alignItems:    'center',
                  gap:           8,
                  marginBottom:  8,
                  paddingLeft:   2,
                }}>
                  <span style={{
                    fontSize:      10,
                    fontWeight:    600,
                    color:         T.accent,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    whiteSpace:    'nowrap',
                    fontFamily:    T.fontUI,
                  }}>
                    {sprint}
                  </span>
                  <div style={{
                    flex:       1,
                    height:     1,
                    background: `linear-gradient(to right, ${T.accent}40, transparent)`,
                  }} />
                  <span style={{
                    fontSize:   10,
                    color:      T.textDisabled,
                    fontFamily: T.fontMono,
                  }}>
                    {groupTasks.length}
                  </span>
                </div>
              )}

              {/* Tasks in this sprint group */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {groupTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', task.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onTaskClick?.(task)}
                    style={{ cursor: 'pointer' }}
                  >
                    <TaskCard
                      task={task}
                      showProjectBadge={showProjectBadges}
                      projectName={task.projectId ? projectById[task.projectId]?.name : undefined}
                      projectColor={task.projectId ? projectById[task.projectId]?.color : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
