// Browser-safe entry: schema halves only. No DOM polyfill, no JSDOM.
// Server-side bridge (markdownToYjsState / yjsStateToMarkdown) is exported
// from `@boppl/schema/node` and pulls in JSDOM — never import it from web code.
export {
  mathBlockNode,
  mathInlineNode,
  mathSchemaPlugin,
  remarkMathPlugin,
} from './math-schema.js';
