---
description: Catch up on a project — what shipped, what changed, what is in flight. Use when the user returns after time away, asks "what did I miss", starts a standup, or picks up unfamiliar work.
---

# Catch up before you start

Read the state of the work before touching it. This is cheap and it stops you
redoing something that already shipped.

## The sequence

1. **`what_shipped`** — merged PRs, the tasks they closed, and the cost, over the
   window the user asks for (default 7 days; `30d` after a longer gap).
2. **`list_recent_activity`** — what moved that was not a PR.
3. **`list_project_tasks`** with `status: in_progress` — what is mid-flight, and
   therefore what not to pick up.

## If they are about to touch a specific file

Call `get_file_history` on it first. It answers who changed it, in which session,
and for which task — grounded in captured activity rather than `git blame`, so it
carries the reasoning as well as the diff.

## If they are picking up a task

`get_task_git_context` on the task id gives its branches, PRs, sessions and the
files those sessions touched. Read it before writing code: it shows whether a PR
is already open, which is the single most common cause of duplicated work.

## Report it as a narrative

Do not dump lists. Say what happened, what is unfinished, and what you would pick
up next — and name the one thing most likely to surprise them.
