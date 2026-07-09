import './sidebar.css';

interface Props {
  workspaceName: string;
  currentPath: string;
  workspaceMode?: string;
  typeCounts?: {
    doc?: number;
    engineering?: number;
    instruction?: number;
    snippet?: number;
  };
  isAdmin?: boolean;
  /** Presence of /app routes whose pages may be absent from this build (the
   *  open-core build omits the enterprise pages). Computed server-side by the
   *  layouts via lib/app-routes.ts; omitted keys default to visible so call
   *  sites that don't pass it keep today's behavior. */
  routes?: { graph?: boolean; meetings?: boolean; admin?: boolean };
}

export function Sidebar({ currentPath, workspaceMode, typeCounts = {}, isAdmin = false, routes = {} }: Props) {
  const typeParam = currentPath.includes('?')
    ? new URLSearchParams(currentPath.split('?')[1]).get('type')
    : null;

  const isOnContent =
    currentPath === '/app/content' || currentPath.startsWith('/app/content');
  const isOnFlows = currentPath.startsWith('/app/flows');
  const isOnCommunity = currentPath.startsWith('/app/community');
  const isOnClaude      = currentPath === '/app/connections/claude';
  const isOnDrive       = currentPath === '/app/connections/drive';
  const isOnChatGPT     = currentPath === '/app/connections/chatgpt';
  const isOnCursor      = currentPath === '/app/connections/cursor';
  const isOnWindsurf    = currentPath === '/app/connections/windsurf';
  const isOnAntigravity = currentPath === '/app/connections/antigravity';
  const isOnAllConns    = currentPath === '/app/settings/connect-apps';
  const isOnNotifications = currentPath.startsWith('/app/notifications');
  const isOnTrash = currentPath.startsWith('/app/trash');
  const isOnProjects  = currentPath.startsWith('/app/projects');
  const isOnKanban    = currentPath.startsWith('/app/kanban');
  const isOnSessions  = currentPath.startsWith('/app/sessions');
  const isOnCost      = currentPath.startsWith('/app/cost');
  const isOnOptimize  = currentPath.startsWith('/app/optimize');
  const isOnTeam      = currentPath.startsWith('/app/team');
  const isOnGraph     = currentPath.startsWith('/app/graph');
  const isOnAdmin     = currentPath.startsWith('/app/admin');
  const isOnMeetings  = currentPath.startsWith('/app/meetings');
  const isOnRequests  = currentPath.startsWith('/app/requests');

  const isDevProject = workspaceMode === 'dev_project';

  const showMeetingsNav = routes.meetings ?? true;
  const showGraphNav    = routes.graph ?? true;
  const showAdminNav    = routes.admin ?? true;

  const showEng = (typeCounts.engineering ?? 0) > 0;
  const showInst = (typeCounts.instruction ?? 0) > 0;
  const showSnip = (typeCounts.snippet ?? 0) > 0;

  const totalDocs =
    (typeCounts.doc ?? 0) +
    (typeCounts.engineering ?? 0) +
    (typeCounts.instruction ?? 0) +
    (typeCounts.snippet ?? 0);

  return (
    <aside className="sb-aside">

      {/* ── CONTENT ──────────────────────────────── */}
      <div className="sb-section">
        <div className="sb-section-head"><span>Content</span></div>

        <a
          href="/app/content"
          className={`sb-row${isOnContent && !typeParam ? ' active' : ''}`}
        >
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </span>
            <span className="sb-label">All docs</span>
          </span>
          {totalDocs > 0 && <span className="sb-count">{totalDocs}</span>}
        </a>

        {showEng && (
          <a
            href="/app/content?type=engineering"
            className={`sb-row indent-1${typeParam === 'engineering' ? ' active' : ''}`}
          >
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                </svg>
              </span>
              <span className="sb-label">Engineering</span>
            </span>
            <span className="sb-count">{typeCounts.engineering}</span>
          </a>
        )}

        {showInst && (
          <a
            href="/app/content?type=instruction"
            className={`sb-row indent-1${typeParam === 'instruction' ? ' active' : ''}`}
          >
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </span>
              <span className="sb-label">Instructions</span>
            </span>
            <span className="sb-count">{typeCounts.instruction}</span>
          </a>
        )}

        {showSnip && (
          <a
            href="/app/content?type=snippet"
            className={`sb-row indent-1${typeParam === 'snippet' ? ' active' : ''}`}
          >
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10" x2="14" y2="10"/><line x1="4" y1="14" x2="18" y2="14"/><line x1="4" y1="18" x2="12" y2="18"/>
                </svg>
              </span>
              <span className="sb-label">Snippets</span>
            </span>
            <span className="sb-count">{typeCounts.snippet}</span>
          </a>
        )}
      </div>

      {/* ── FLOWS ────────────────────────────────── */}
      <div className="sb-section">
        <div className="sb-section-head"><span>Flows</span></div>

        <a
          href="/app/flows"
          className={`sb-row${isOnFlows ? ' active' : ''}`}
        >
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/>
                <path d="M6 9v3a3 3 0 0 0 3 3h3M15 6h-3"/><path d="M18 15v-3"/>
              </svg>
            </span>
            <span className="sb-label">All flows</span>
          </span>
        </a>

        <a
          href="/app/community"
          className={`sb-row${isOnCommunity ? ' active' : ''}`}
        >
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </span>
            <span className="sb-label">Community</span>
          </span>
        </a>
      </div>

      {/* ── MEETINGS ─────────────────────────────── */}
      <div className="sb-section">
        <div className="sb-section-head"><span>Meetings</span></div>
        {showMeetingsNav && (
          <a href="/app/meetings" className={`sb-row${isOnMeetings ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </span>
              <span className="sb-label">Meetings</span>
            </span>
          </a>
        )}
        <a href="/app/requests" className={`sb-row${isOnRequests ? ' active' : ''}`}>
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12l2 2 4-4"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 5c0 1.66 4 3 9 3s9-1.34 9-3-4-3-9-3-9 1.34-9 3z"/>
              </svg>
            </span>
            <span className="sb-label">Access requests</span>
          </span>
        </a>
      </div>

      {/* ── DEV (dev_project workspaces only) ───── */}
      {isDevProject && (
        <div className="sb-section">
          <div className="sb-section-head"><span>Dev</span></div>

          <a href="/app/projects" className={`sb-row${isOnProjects ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/>
                </svg>
              </span>
              <span className="sb-label">Projects</span>
            </span>
          </a>

          <a href="/app/kanban" className={`sb-row${isOnKanban ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="5" height="18" rx="1"/>
                  <rect x="10" y="3" width="5" height="13" rx="1"/>
                  <rect x="17" y="3" width="5" height="9" rx="1"/>
                </svg>
              </span>
              <span className="sb-label">Kanban</span>
            </span>
          </a>

          <a href="/app/sessions" className={`sb-row${isOnSessions ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>
                </svg>
              </span>
              <span className="sb-label">Sessions</span>
            </span>
          </a>

          <a href="/app/cost" className={`sb-row${isOnCost ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </span>
              <span className="sb-label">Cost</span>
            </span>
          </a>

          <a href="/app/optimize" className={`sb-row${isOnOptimize ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </span>
              <span className="sb-label">Optimize</span>
            </span>
          </a>

          <a href="/app/team" className={`sb-row${isOnTeam ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </span>
              <span className="sb-label">Team</span>
            </span>
          </a>
        </div>
      )}

      {/* ── GRAPH (both modes) ───────────────────── */}
      {showGraphNav && (
        <div className="sb-section">
          <div className="sb-section-head"><span>Knowledge</span></div>
          <a href="/app/graph" className={`sb-row${isOnGraph ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/>
                  <line x1="7" y1="11.5" x2="17" y2="6"/><line x1="7" y1="12.5" x2="17" y2="18"/>
                </svg>
              </span>
              <span className="sb-label">Graph</span>
            </span>
          </a>
        </div>
      )}

      {/* ── ADMIN (staff only) ───────────────────── */}
      {isAdmin && showAdminNav && (
        <div className="sb-section">
          <div className="sb-section-head"><span>Admin</span></div>
          <a href="/app/admin" className={`sb-row${isOnAdmin && !currentPath.startsWith('/app/admin/licenses') && !currentPath.startsWith('/app/admin/logs') && !currentPath.startsWith('/app/admin/audit') ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l8 4v6c0 4-3 7-8 10-5-3-8-6-8-10V6z"/>
                </svg>
              </span>
              <span className="sb-label">Dashboard</span>
            </span>
          </a>
          <a href="/app/admin/licenses" className={`sb-row${currentPath.startsWith('/app/admin/licenses') ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </span>
              <span className="sb-label">Licenses</span>
            </span>
          </a>
          <a href="/app/admin/board" className={`sb-row${currentPath.startsWith('/app/admin/board') ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="14" rx="1"/>
                </svg>
              </span>
              <span className="sb-label">Ops board</span>
            </span>
          </a>
          <a href="/app/admin/logs" className={`sb-row${currentPath.startsWith('/app/admin/logs') ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16M4 9h16M4 14h10M4 19h7"/>
                </svg>
              </span>
              <span className="sb-label">Live logs</span>
            </span>
          </a>
          <a href="/app/admin/audit" className={`sb-row${currentPath.startsWith('/app/admin/audit') ? ' active' : ''}`}>
            <span className="sb-l">
              <span className="sb-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
              </span>
              <span className="sb-label">Audit log</span>
            </span>
          </a>
        </div>
      )}

      {/* ── CONNECTIONS ──────────────────────────── */}
      <div className="sb-section">
        <div className="sb-section-head">
          <span>Connections</span>
          <a href="/app/settings/connect-apps" className="sb-section-action" title="All connections">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </a>
        </div>

        {/* Claude Desktop */}
        <a href="/app/connections/claude" className={`sb-row${isOnClaude ? ' active' : ''}`}>
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>
              </svg>
            </span>
            <span className="sb-label">Claude Desktop</span>
          </span>
        </a>

        {/* ChatGPT */}
        <a href="/app/connections/chatgpt" className={`sb-row${isOnChatGPT ? ' active' : ''}`}>
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            <span className="sb-label">ChatGPT</span>
          </span>
        </a>

        {/* Cursor */}
        <a href="/app/connections/cursor" className={`sb-row${isOnCursor ? ' active' : ''}`}>
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
            </span>
            <span className="sb-label">Cursor</span>
          </span>
        </a>

        {/* Windsurf */}
        <a href="/app/connections/windsurf" className={`sb-row${isOnWindsurf ? ' active' : ''}`}>
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
              </svg>
            </span>
            <span className="sb-label">Windsurf</span>
          </span>
        </a>

        {/* Antigravity */}
        <a href="/app/connections/antigravity" className={`sb-row${isOnAntigravity ? ' active' : ''}`}>
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </span>
            <span className="sb-label">Antigravity</span>
          </span>
        </a>

        {/* Google Drive */}
        <a href="/app/connections/drive" className={`sb-row${isOnDrive ? ' active' : ''}`}>
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
              </svg>
            </span>
            <span className="sb-label">Google Drive</span>
          </span>
        </a>
      </div>

      {/* ── ACCOUNT ─────────────────────────────── */}
      <div className="sb-section">
        <div className="sb-section-head"><span>Account</span></div>

        <a
          href="/app/notifications"
          className={`sb-row${isOnNotifications ? ' active' : ''}`}
        >
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
              </svg>
            </span>
            <span className="sb-label">Notifications</span>
          </span>
        </a>

        <a
          href="/app/trash"
          className={`sb-row${isOnTrash ? ' active' : ''}`}
        >
          <span className="sb-l">
            <span className="sb-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </span>
            <span className="sb-label">Trash</span>
          </span>
        </a>
      </div>

      {/* ── FOOTER ───────────────────────────────── */}
      <div className="sb-foot">
        <span>MCP usage</span>
        <span><span className="sb-v">—</span></span>
      </div>

    </aside>
  );
}
