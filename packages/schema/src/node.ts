// Node-only entry: pulls in JSDOM + headless Milkdown for server-side
// markdown ↔ Y.Doc conversion. Importing this from browser code is a bug;
// Vite will (try to) bundle JSDOM and fail loudly.
export { getEditorSchema, getHeadlessEditor } from './editor-schema.js';
export { markdownToYjsState } from './md-to-ydoc.js';
export { yjsStateToMarkdown } from './ydoc-to-md.js';
