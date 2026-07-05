/**
 * CSS inliner for email templates.
 *
 * Reads HTML files from emails/html/, inlines all CSS (except @media queries
 * which must stay as <style> blocks — email clients that support dark mode
 * need them), and caches the result per process lifetime.
 *
 * Variable substitution: replaces {{snake_case}} placeholders with
 * HTML-escaped values. Warns on unreplaced placeholders.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import juice from 'juice';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_DIR = join(__dirname, 'html');

const templateCache = new Map<string, string>();

export function loadTemplate(slug: string): string {
  if (templateCache.has(slug)) return templateCache.get(slug)!;

  const filePath = join(HTML_DIR, `${slug}.html`);
  const raw = readFileSync(filePath, 'utf-8');

  // juice inlines all CSS; preserveMediaQueries keeps dark-mode <style> blocks
  const inlined = juice(raw, {
    preserveMediaQueries: true,
    preserveFontFaces: true,
    removeStyleTags: true,
    applyWidthAttributes: true,
  });

  templateCache.set(slug, inlined);
  return inlined;
}

export function renderTemplate(slug: string, vars: Record<string, string>): string {
  let html = loadTemplate(slug);

  for (const [key, value] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, escapeHtml(value));
  }

  // Warn on any unreplaced placeholders so template mismatches surface fast
  const unreplaced = html.match(/\{\{[a-z_]+\}\}/g);
  if (unreplaced?.length) {
    console.warn(`[email:inliner] unreplaced placeholders in ${slug}:`, unreplaced);
  }

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
