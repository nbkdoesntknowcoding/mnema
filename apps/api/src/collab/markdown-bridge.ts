// Thin re-exports — the bridge implementation lives in @boppl/schema so the
// browser editor and the headless Node process share one schema definition.
// We import from the `/node` subpath so JSDOM never enters the web bundle.
export { markdownToYjsState, yjsStateToMarkdown } from '@boppl/schema/node';
