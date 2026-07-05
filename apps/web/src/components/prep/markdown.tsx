import { useMemo } from 'react';
import { marked } from 'marked';
import { sanitizeMarkup } from '../../lib/sanitize';

marked.setOptions({ gfm: true, breaks: false });

/**
 * Renders trusted, build-time placement content (model answers, worked solutions,
 * code blocks, DI tables) as markdown. Content is our own generated data, not user
 * input, so the HTML is safe to inject. Styling hooks off the `prep-md` class
 * (see PrepApp's <style>).
 */
export function Markdown({ md, className }: { md: string; className?: string }) {
  const html = useMemo(() => (md ? sanitizeMarkup(marked.parse(md) as string) : ''), [md]);
  return (
    <div
      className={`prep-md${className ? ' ' + className : ''}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
