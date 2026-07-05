/**
 * DOM construction for the autocomplete ghost decoration.
 *
 * Two children inside one wrapper:
 *   - the ghost-text span (dimmer color, identical font metrics)
 *   - the "AI" pill (small, fades in 200ms after the ghost text appears)
 *
 * `contenteditable="false"` on the wrapper is critical — without it,
 * ProseMirror would let the user click inside the ghost and try to edit
 * non-document DOM, which corrupts the editor's state assumptions.
 *
 * `pointer-events: none` (set in CSS) is the second line of defense —
 * even if the wrapper is clicked, no events reach it.
 */
export function createGhostWidget(text: string): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'autocomplete-ghost-wrapper';
  wrapper.setAttribute('contenteditable', 'false');

  const ghost = document.createElement('span');
  ghost.className = 'autocomplete-ghost-text';
  ghost.textContent = text;

  const pill = document.createElement('span');
  pill.className = 'autocomplete-ai-pill';
  pill.textContent = 'AI';
  // Hide from screen readers — the ghost text is the meaningful affordance,
  // the pill is decorative.
  pill.setAttribute('aria-hidden', 'true');

  wrapper.appendChild(ghost);
  wrapper.appendChild(pill);
  return wrapper;
}
