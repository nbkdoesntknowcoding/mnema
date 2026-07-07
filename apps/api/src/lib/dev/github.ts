/**
 * GitHub PR attribution helper (Phase 2 AgentLens).
 *
 * When a session completes, looks up GitHub for an open/merged PR from
 * the session's git branch. Updates the session and linked task with the PR URL.
 *
 * Requires env vars:
 *   GITHUB_TOKEN       - personal access token or GitHub App token with repo scope
 *   GITHUB_REPO_OWNER  - repository owner (org or user, e.g. 'example-org')
 *   GITHUB_REPO_NAME   - repository name (e.g. 'project-x')
 *
 * If GITHUB_TOKEN is not set, all functions return null silently.
 * Errors are always swallowed — attribution is best-effort.
 */

export interface PrInfo {
  url:    string;
  status: 'open' | 'merged' | 'closed';
}

/**
 * Parses owner/name out of a GitHub repo URL as stored on projects
 * (projects.github_repo_url): https://github.com/owner/repo with or without
 * .git or a trailing slash, or the SSH form git@github.com:owner/repo.git.
 * Returns null for anything else.
 */
export function parseGithubRepoUrl(url: string): { owner: string; name: string } | null {
  const match = /(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) return null;
  return { owner: match[1]!, name: match[2]! };
}

/**
 * Fetches the most recent PR for a given branch from GitHub.
 * Returns null if not found, token missing, or any error occurs.
 */
export async function findPrForBranch(
  branch:    string,
  repoOwner: string,
  repoName:  string,
): Promise<PrInfo | null> {
  if (!process.env.GITHUB_TOKEN) return null;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/pulls?head=${repoOwner}:${branch}&state=all&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept:        'application/vnd.github+json',
          'User-Agent':  'mnema-agentlens/1.0',
        },
      },
    );

    if (!res.ok) {
      console.warn(`[github] PR lookup returned ${res.status} for branch ${branch}`);
      return null;
    }

    const pulls = (await res.json()) as Array<{
      html_url: string;
      merged:   boolean | null;
      state:    string;
    }>;

    if (!Array.isArray(pulls) || pulls.length === 0) return null;

    const pr = pulls[0];
    if (!pr) return null;

    const status: PrInfo['status'] = pr.merged ? 'merged' : (pr.state === 'closed' ? 'closed' : 'open');

    return {
      url:    pr.html_url,
      status,
    };
  } catch (err) {
    console.error('[github] findPrForBranch error:', err);
    return null;
  }
}
