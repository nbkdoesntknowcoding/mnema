---
description: Answer a question from the workspace's accumulated knowledge instead of guessing. Use for any question about a topic, decision, person, project or doc, and for how-many / top-N / list-the-X questions.
---

# Ask the brain before you answer

If the workspace might know, ask it. Answering from memory when a recorded answer
exists is how a shared brain quietly becomes a private one.

## One call, not a chain

`what_do_we_know` with the topic resolves it, pulls the summary, the docs it came
from and when, what it connects to, and any current decision — server-side. Do
**not** chain searches to rebuild that yourself.

It also answers questions about a **type** rather than a named thing: "how many
decisions do we have", "top three rationales", "biggest clusters". It reads the
graph's own totals, so it can count. `search_docs` cannot — asked "how many
decisions", document search will say it does not see a count, which is wrong.
Route every how-many / top-N / list question here.

## When to use something else

- **You know the doc** → `get_doc`, or `get_doc_section` for one section
- **Discovering docs by topic** → `search_docs` (hybrid mode)
- **Tracing a connection between two things** → `traverse_graph`

## If nothing is recorded

It will say so plainly. **Trust that and say it.** Do not fill the gap with a
plausible answer — an invented fact in a shared brain outlives the conversation
that produced it, and the next person has no way to tell it was invented.

Offer to record the answer once it is known, so the next person asking gets it.
