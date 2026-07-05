import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { streamCompletion } from './client';
import { createGhostWidget } from './ghost-widget';
import { extractContext, shouldTrigger } from './trigger';

/**
 * The autocomplete ProseMirror plugin.
 *
 * UX contract:
 *   - 350ms trailing debounce after the last keystroke
 *   - request fires only when the trigger gate (see trigger.ts) returns ok
 *   - any new keystroke during an in-flight request aborts it via
 *     AbortController and the response (if any) is discarded
 *   - the suggestion is rendered as a Decoration.widget — the document is
 *     unchanged until the user accepts
 *   - Tab accepts the suggestion (insertText at the issued position)
 *   - Esc dismisses
 *   - any doc change or cursor move dismisses (state.apply does this)
 *
 * The widget DOM is built by createGhostWidget. The plugin only knows
 * "there is a suggestion at position P" — never owns the DOM directly.
 */

export interface AutocompletePluginOptions {
  docId: string;
  debounceMs: number;
  maxPrefixChars: number;
  maxSuffixChars: number;
}

interface PluginStateShape {
  suggestion: string | null;
  suggestionAtPos: number | null;
  decorations: DecorationSet;
}

export const autocompletePluginKey = new PluginKey<PluginStateShape>('boppl-autocomplete');

const META_KEY = 'boppl-autocomplete-set';

interface SuggestionMeta {
  suggestion: string | null;
  suggestionAtPos: number | null;
}

export function createAutocompletePlugin(
  opts: AutocompletePluginOptions,
): Plugin<PluginStateShape> {
  // Per-plugin-instance state. Captured in the closure so each editor
  // mount has its own debounce timer and abort controller.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inflightController: AbortController | null = null;

  function clearInflight(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (inflightController !== null) {
      inflightController.abort();
      inflightController = null;
    }
  }

  function scheduleRequest(view: EditorView): void {
    clearInflight();
    debounceTimer = setTimeout(() => {
      void runCompletion(view);
    }, opts.debounceMs);
  }

  async function runCompletion(view: EditorView): Promise<void> {
    debounceTimer = null;
    const state = view.state;
    const gate = shouldTrigger(state);
    if (!gate.ok) return;

    const { prefix, suffix } = extractContext(
      state,
      opts.maxPrefixChars,
      opts.maxSuffixChars,
    );
    if (prefix.length === 0) return;

    const controller = new AbortController();
    inflightController = controller;
    const issuedAtPos = state.selection.from;

    // RAF-coalesced incremental rendering. Gemini Flash-Lite streams
    // tokens at ~50 deltas/sec; without coalescing we'd dispatch 50
    // ProseMirror transactions per second, hammering the editor's
    // re-render path. RAF caps us at the display refresh rate (~60 Hz)
    // and lets the browser interleave rendering between updates.
    let pendingText: string | null = null;
    let rafScheduled = false;

    function commitPending(): void {
      rafScheduled = false;
      if (pendingText === null) return;
      if (controller.signal.aborted) return;
      // Late-arrival check: cursor moved between issue and this frame.
      // Abort the inflight call so subsequent deltas don't trickle in.
      if (view.state.selection.from !== issuedAtPos) {
        controller.abort();
        return;
      }
      const meta: SuggestionMeta = {
        suggestion: pendingText,
        suggestionAtPos: issuedAtPos,
      };
      view.dispatch(view.state.tr.setMeta(META_KEY, meta));
      pendingText = null;
    }

    try {
      const finalText = await streamCompletion(
        { prefix, suffix, doc_id: opts.docId },
        controller.signal,
        (cumulativeText) => {
          pendingText = cumulativeText;
          if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(commitPending);
          }
        },
      );

      if (controller.signal.aborted) return;

      // Final commit safety net: if the last delta arrived just before
      // stream-done and RAF hasn't fired yet, force the final paint.
      if (finalText && view.state.selection.from === issuedAtPos) {
        const meta: SuggestionMeta = {
          suggestion: finalText,
          suggestionAtPos: issuedAtPos,
        };
        view.dispatch(view.state.tr.setMeta(META_KEY, meta));
      }
    } catch (err) {
      // Both AbortError and 429-shaped errors are silent dismissals —
      // the next debounce cycle is the organic recovery path.
      if ((err as Error).name === 'AbortError') return;
      if ((err as Error).message?.includes('429')) return;
      console.warn('[autocomplete] stream failed', err);
    } finally {
      if (inflightController === controller) inflightController = null;
    }
  }

  function dismissSuggestion(view: EditorView): boolean {
    const current = autocompletePluginKey.getState(view.state);
    if (!current?.suggestion) return false;
    const meta: SuggestionMeta = { suggestion: null, suggestionAtPos: null };
    view.dispatch(view.state.tr.setMeta(META_KEY, meta));
    return true;
  }

  function acceptSuggestion(view: EditorView): boolean {
    const current = autocompletePluginKey.getState(view.state);
    if (!current?.suggestion || current.suggestionAtPos === null) return false;

    const pos = current.suggestionAtPos;
    const suggestion = current.suggestion;

    // Space-guard: if the character immediately before the insertion point
    // is not whitespace AND the suggestion doesn't open with whitespace,
    // prepend a single space. This prevents "smooth" + "Hocuspocus" → "smoothHocuspocus"
    // when the user accepted before typing a trailing space.
    const charBefore = pos > 0
      ? view.state.doc.textBetween(pos - 1, pos, '\n')
      : '';
    const needsSpace =
      charBefore.length > 0 &&
      !/\s/.test(charBefore) &&
      !/^\s/.test(suggestion);

    const tr = view.state.tr;
    tr.insertText(needsSpace ? ' ' + suggestion : suggestion, pos);
    const meta: SuggestionMeta = { suggestion: null, suggestionAtPos: null };
    tr.setMeta(META_KEY, meta);
    view.dispatch(tr);
    return true;
  }

  return new Plugin<PluginStateShape>({
    key: autocompletePluginKey,
    state: {
      init: () => ({
        suggestion: null,
        suggestionAtPos: null,
        decorations: DecorationSet.empty,
      }),
      apply(tr: Transaction, prev: PluginStateShape, _oldState, newState): PluginStateShape {
        const meta = tr.getMeta(META_KEY) as SuggestionMeta | undefined;

        // Explicit set/clear from runCompletion / accept / dismiss wins.
        if (meta !== undefined) {
          if (meta.suggestion && meta.suggestionAtPos !== null) {
            const text = meta.suggestion;
            const widget = Decoration.widget(
              meta.suggestionAtPos,
              () => createGhostWidget(text),
              {
                // side: 1 means render after the cursor position so the ghost
                // sits visually at the cursor's right edge, not its left.
                side: 1,
                key: 'boppl-autocomplete-ghost',
              },
            );
            return {
              suggestion: meta.suggestion,
              suggestionAtPos: meta.suggestionAtPos,
              decorations: DecorationSet.create(newState.doc, [widget]),
            };
          }
          return {
            suggestion: null,
            suggestionAtPos: null,
            decorations: DecorationSet.empty,
          };
        }

        // Doc changed (user typed) — kill any visible suggestion. The new
        // suggestion (if any) will arrive via runCompletion → setMeta.
        if (tr.docChanged && prev.suggestion) {
          return {
            suggestion: null,
            suggestionAtPos: null,
            decorations: DecorationSet.empty,
          };
        }

        // Selection moved off the issued position — dismiss.
        if (
          prev.suggestion &&
          prev.suggestionAtPos !== null &&
          newState.selection.from !== prev.suggestionAtPos
        ) {
          return {
            suggestion: null,
            suggestionAtPos: null,
            decorations: DecorationSet.empty,
          };
        }

        // Otherwise: map decorations forward through the transaction so
        // surrounding edits (rare while a suggestion is up) don't desync.
        return {
          ...prev,
          decorations: prev.decorations.map(tr.mapping, tr.doc),
        };
      },
    },
    props: {
      decorations(state) {
        return autocompletePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
      handleKeyDown(view, event) {
        const current = autocompletePluginKey.getState(view.state);
        if (event.key === 'Tab' && current?.suggestion) {
          event.preventDefault();
          acceptSuggestion(view);
          return true;
        }
        if (event.key === 'Escape' && current?.suggestion) {
          event.preventDefault();
          dismissSuggestion(view);
          return true;
        }
        // Tab without a suggestion falls through to whatever else handles
        // it (list indent, etc.) — explicitly do NOT eat it.
        return false;
      },
    },
    view() {
      // The view-level update hook is where we observe doc changes vs
      // cursor moves and decide whether to schedule a new request. The
      // plugin state above only handles in-state transitions.
      return {
        update(updatedView, prevState) {
          const newState = updatedView.state;
          const docChanged = !newState.doc.eq(prevState.doc);
          const cursorMoved =
            newState.selection.from !== prevState.selection.from;

          if (docChanged) {
            // User typed — abort any in-flight; schedule a new request if
            // the cursor is in a triggerable spot.
            clearInflight();
            const gate = shouldTrigger(newState);
            if (gate.ok) scheduleRequest(updatedView);
          } else if (cursorMoved) {
            // Cursor moved without typing (click, arrow keys) — abort
            // any in-flight; do NOT schedule a new request. Suggestions
            // should follow typing, not navigation.
            clearInflight();
          }
        },
        destroy() {
          clearInflight();
        },
      };
    },
  });
}
