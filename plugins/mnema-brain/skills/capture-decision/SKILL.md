---
description: Record a decision and the reasoning behind it so it stays queryable later. Use when the user decides something, changes approach, rejects an option, or says "let's go with X" or "remember why we did this".
---

# Capture a decision, with the reasoning

Most decisions are lost the moment the conversation ends. The commit says what
changed; nothing says why, or what was rejected. Six months later someone
re-opens the same argument because the reasoning was never written down.

## When to reach for this

- The user picks between options
- They reject an approach, and the reason matters
- They say "let's go with", "we decided", "remember why"
- A tradeoff was made that a future reader would otherwise re-litigate

Do **not** capture trivia. A decision worth recording is one someone could
reasonably question later.

## What to record

Call `record_decision` with:

- **the decision** — what was chosen, stated plainly
- **the rationale** — *why*, including what it costs
- **the alternatives rejected**, and why they lost. This is the part that stops
  the argument being re-run, and the part people always omit.

Write it so it makes sense to someone who was not in the room. "Chose Postgres"
is not a decision record. "Chose Postgres over SQLite because we need concurrent
writers from the worker pool; accepted the ops cost of a managed instance" is.

## After recording

Say where it landed and how to get it back — `what_do_we_know` with the topic
returns it, with its sources and date. A decision that cannot be retrieved was
not captured, it was just typed.
