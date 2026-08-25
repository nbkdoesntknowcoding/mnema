---
description: Set up Mnema and seed the workspace so it is not empty. Use on first run, after installing the mnema-brain plugin, or when the user says Mnema is connected but there is nothing in it.
---

# First run — connect, then put something in the room

A brand-new workspace is an empty room. An empty room is why people install this,
look at it once, and never come back. Your job on first run is not "confirm the
connection" — it is to leave the user with something worth reading.

## 1. Confirm the connection

Call `whoami`. If it fails with an auth error, the user has not completed the
OAuth flow yet — tell them to run `/mcp` and authenticate with `mnema`, then stop
and wait. Do not continue against a dead connection.

Report which workspace they landed in. If they expected a different one, stop —
writing into the wrong workspace is worse than writing nothing.

## 2. Find out whether the room is actually empty

Call `list_docs` (limit 5) and `list_projects`.

- **Docs already exist** → this is not a cold start. Say what is there and stop.
  Do not seed a workspace that has content.
- **Empty** → continue.

## 3. Seed it from the work in front of you

The fastest honest seed is the repository the user is sitting in. Do not invent
content — capture what is real:

1. Read the repo's `README`, and `CLAUDE.md` or `AGENTS.md` if present.
2. Propose ONE doc summarising what this project is, what it is built with, and
   how to run it. Use `propose_doc_write` — never write without the approval gate.
3. If the repo has a git history, call `what_shipped` and offer to record the
   most recent meaningful change as a decision (see the `capture-decision` skill).

Show the user the proposed content before it is written. The approval gate is the
product, not an obstacle.

## 4. Tell them what just became possible

Now that one real doc exists, demonstrate the loop rather than describing it:
`search_docs` for a term from the doc you just created, and show it coming back.

That round trip — you wrote it, the agent reads it live — is the whole idea.
