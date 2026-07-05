/**
 * Claude Code hook payload adapter.
 *
 * Claude Code fires hooks at lifecycle points via PostToolUse, PreToolUse,
 * and Stop event names. This module normalises the raw JSON body into a
 * typed payload and provides helpers to extract structured fields.
 *
 * Reference: devmanager/adapters/claude_code.go
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClaudeCodeUsage {
  input_tokens:        number;
  output_tokens:       number;
  cache_read_tokens?:  number;
  cache_write_tokens?: number;
}

/**
 * Normalised Claude Code hook payload.
 * All optional fields have safe defaults set by normaliseClaudeCodePayload().
 */
export interface ClaudeCodeHookPayload {
  hook_event_name: 'PostToolUse' | 'PreToolUse' | 'Stop' | string;
  session_id:      string;
  tool_name:       string;
  tool_input?:     Record<string, unknown>;
  tool_response?:  Record<string, unknown>;
  duration_ms?:    number;
  usage?:          ClaudeCodeUsage;
  model?:          string;
  developer_id?:   string;
  git_branch?:     string;
  git_commit?:     string;
  workspace_id?:   string;
  is_error?:       boolean;
  error_message?:  string;
  exit_code?:      number;
}

// ── Normaliser ────────────────────────────────────────────────────────────────

/**
 * Validates and normalises a raw hook payload.
 * Throws if the payload is fundamentally malformed (no session_id).
 * Sets safe defaults for all optional fields.
 */
export function normaliseClaudeCodePayload(raw: unknown): ClaudeCodeHookPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Hook payload must be a JSON object');
  }

  const body = raw as Record<string, unknown>;

  // session_id is mandatory — without it we cannot correlate events
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!sessionId) {
    throw new Error('Hook payload missing session_id');
  }

  const hookEventName = typeof body.hook_event_name === 'string'
    ? body.hook_event_name
    : 'PostToolUse';

  const toolName = typeof body.tool_name === 'string'
    ? body.tool_name
    : 'unknown';

  let usage: ClaudeCodeUsage | undefined;
  if (body.usage && typeof body.usage === 'object') {
    const u = body.usage as Record<string, unknown>;
    usage = {
      input_tokens:        typeof u.input_tokens === 'number' ? u.input_tokens : 0,
      output_tokens:       typeof u.output_tokens === 'number' ? u.output_tokens : 0,
      cache_read_tokens:   typeof u.cache_read_tokens === 'number' ? u.cache_read_tokens : 0,
      cache_write_tokens:  typeof u.cache_write_tokens === 'number' ? u.cache_write_tokens : 0,
    };
  }

  return {
    hook_event_name: hookEventName,
    session_id:      sessionId,
    tool_name:       toolName,
    tool_input:      (body.tool_input && typeof body.tool_input === 'object')
                       ? (body.tool_input as Record<string, unknown>)
                       : undefined,
    tool_response:   (body.tool_response && typeof body.tool_response === 'object')
                       ? (body.tool_response as Record<string, unknown>)
                       : undefined,
    duration_ms:     typeof body.duration_ms === 'number' ? body.duration_ms : undefined,
    usage,
    model:           typeof body.model === 'string' ? body.model : undefined,
    developer_id:    typeof body.developer_id === 'string' ? body.developer_id : 'unknown',
    git_branch:      typeof body.git_branch === 'string' ? body.git_branch : undefined,
    git_commit:      typeof body.git_commit === 'string' ? body.git_commit : undefined,
    workspace_id:    typeof body.workspace_id === 'string' ? body.workspace_id : undefined,
    is_error:        typeof body.is_error === 'boolean' ? body.is_error : false,
    error_message:   typeof body.error_message === 'string' ? body.error_message : undefined,
    exit_code:       typeof body.exit_code === 'number' ? body.exit_code : undefined,
  };
}

// ── File path extractor ───────────────────────────────────────────────────────

/**
 * Extracts the primary file path from a tool's input arguments.
 * Returns null for tools that don't operate on files (Bash, WebSearch, etc.).
 */
export function extractFilePath(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  switch (toolName) {
    case 'Write':
      return typeof toolInput.file_path === 'string' ? toolInput.file_path : null;
    case 'Read':
      return typeof toolInput.file_path === 'string' ? toolInput.file_path : null;
    case 'Edit':
      return typeof toolInput.file_path === 'string' ? toolInput.file_path : null;
    case 'MultiEdit':
      // MultiEdit has an array of edits, each with file_path
      if (Array.isArray(toolInput.edits) && toolInput.edits.length > 0) {
        const first = toolInput.edits[0] as Record<string, unknown>;
        return typeof first.file_path === 'string' ? first.file_path : null;
      }
      return null;
    case 'NotebookEdit':
      return typeof toolInput.notebook_path === 'string' ? toolInput.notebook_path : null;
    default:
      return null;
  }
}

// ── Content extractor ─────────────────────────────────────────────────────────

/**
 * Extracts the new file content from a Write tool's response.
 * Used to generate unified diffs.
 */
export function extractWriteContent(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: Record<string, unknown> | undefined,
): { oldContent?: string; newContent?: string } {
  if (toolName === 'Write') {
    // Write tool: input contains the new content
    return {
      oldContent: undefined, // no old content in Write — creates or overwrites
      newContent: typeof toolInput.content === 'string' ? toolInput.content : undefined,
    };
  }

  if (toolName === 'Edit' || toolName === 'MultiEdit') {
    // Edit/MultiEdit: response may include old_content/new_content
    if (toolResponse) {
      return {
        oldContent: typeof toolResponse.old_content === 'string' ? toolResponse.old_content : undefined,
        newContent: typeof toolResponse.new_content === 'string' ? toolResponse.new_content : undefined,
      };
    }
  }

  return {};
}
