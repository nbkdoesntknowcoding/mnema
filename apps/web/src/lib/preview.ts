/**
 * Cross-app floating doc preview.
 *
 * Any surface (docs list context menu, flow doc picker, graph node card, …)
 * opens the preview by dispatching a single window event. The global
 * DocPreviewHost island (mounted in AppLayout) listens and renders the
 * floating, resizable preview window.
 */
export const PREVIEW_EVENT = 'mnema:preview-doc';

export function openDocPreview(docId: string): void {
  if (!docId || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: { docId } }));
}
