import './_dom-shim.js';
import {
  Editor,
  defaultValueCtx,
  parserCtx,
  schemaCtx,
  serializerCtx,
} from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { mathSchemaPlugin } from './math-schema.js';

interface CachedEditor {
  schema: Schema;
  parser: (md: string) => PMNode | undefined;
  serializer: (doc: PMNode) => string;
}

let cached: Promise<CachedEditor> | null = null;

async function build(): Promise<CachedEditor> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(defaultValueCtx, '');
    })
    .use(commonmark)
    .use(gfm)
    .use(mathSchemaPlugin)
    .create();
  return {
    schema: editor.action((ctx) => ctx.get(schemaCtx)),
    parser: editor.action((ctx) => ctx.get(parserCtx)) as (md: string) => PMNode | undefined,
    serializer: editor.action((ctx) => ctx.get(serializerCtx)) as (doc: PMNode) => string,
  };
}

/** Returns a cached headless editor's schema, parser, and serializer. */
export function getHeadlessEditor(): Promise<CachedEditor> {
  if (!cached) cached = build();
  return cached;
}

export async function getEditorSchema(): Promise<Schema> {
  const e = await getHeadlessEditor();
  return e.schema;
}
