import { useEffect, useState } from 'react';
import { PREVIEW_EVENT } from '../../lib/preview';
import { FloatingDocPreview } from './FloatingDocPreview';

/**
 * Single global host for the floating doc preview. Mounted once in AppLayout so
 * it is available across the docs list, flow builder, graph, etc.
 *
 * Opens on:
 *   - the `mnema:preview-doc` window event (dispatched via openDocPreview), or
 *   - a right-click on any `[data-doc-id]` element that does NOT already handle
 *     the contextmenu itself (it skips when e.defaultPrevented, so surfaces with
 *     their own menu — e.g. the docs list tiles — keep theirs).
 */
export function DocPreviewHost() {
  const [docId, setDocId] = useState<string | null>(null);

  useEffect(() => {
    const onPreview = (e: Event) => {
      const id = (e as CustomEvent).detail?.docId;
      if (typeof id === 'string' && id) setDocId(id);
    };
    const onCtx = (e: MouseEvent) => {
      if (e.defaultPrevented) return; // a local menu already handled this right-click
      const el = (e.target as HTMLElement | null)?.closest?.('[data-doc-id]') as HTMLElement | null;
      const id = el?.getAttribute('data-doc-id');
      if (!id) return;
      e.preventDefault();
      setDocId(id);
    };

    window.addEventListener(PREVIEW_EVENT, onPreview);
    document.addEventListener('contextmenu', onCtx);
    return () => {
      window.removeEventListener(PREVIEW_EVENT, onPreview);
      document.removeEventListener('contextmenu', onCtx);
    };
  }, []);

  if (!docId) return null;
  return <FloatingDocPreview docId={docId} onClose={() => setDocId(null)} />;
}
