import type { McpAuthContext } from '../auth.js';
import { ADD_FLOW_NODE_TOOL, addFlowNode } from './add-flow-node.js';
import { CONNECT_FLOW_NODES_TOOL, connectFlowNodes } from './connect-flow-nodes.js';
import { CREATE_FLOW_TOOL, createFlow } from './create-flow.js';
import { CREATE_FOLDER_TOOL, createFolder } from './create-folder.js';
import { GET_DOC_SECTION_TOOL, getDocSection } from './get-doc-section.js';
import { GET_DOC_TOOL, getDoc } from './get-doc.js';
// get-flow-step is registered in server.ts as an App tool (Phase 11 Chunk A)
// get-flow is registered in server.ts as an App tool (Phase 12 Chunk A)
import { LIST_DOCS_TOOL, listDocs } from './list-docs.js';
import { LIST_FLOWS_TOOL, listFlows } from './list-flows.js';
import { LIST_FOLDERS_TOOL, listFolders } from './list-folders.js';
import { MOVE_DOC_TOOL, moveDoc } from './move-doc.js';
import { MOVE_FOLDER_TOOL, moveFolder } from './move-folder.js';
import { NOTIFY_MEMBERS_TOOL, notifyMembers } from './notify-members.js';
import { REMOVE_FLOW_EDGE_TOOL, removeFlowEdge } from './remove-flow-edge.js';
import { REMOVE_FLOW_NODE_TOOL, removeFlowNode } from './remove-flow-node.js';
import { RENAME_FOLDER_TOOL, renameFolder } from './rename-folder.js';
import { SEARCH_DOCS_TOOL, searchDocs } from './search-docs.js';
import { UPDATE_FLOW_NODE_TOOL, updateFlowNode } from './update-flow-node.js';
// Sprint 4 Chunk E — project tools (both workspace modes)
import { GET_PROJECT_TOOL, getProject } from './get-project.js';
import { LIST_PROJECTS_TOOL, listProjects } from './list-projects.js';
import { WHOAMI_TOOL, whoami } from './whoami.js';
import { REQUEST_DOC_ACCESS_TOOL, requestDocAccess } from './request-doc-access.js';
import { RECORD_DECISION_TOOL, recordDecisionTool } from './record-decision.js';
import { LIST_RECENT_ACTIVITY_TOOL, listRecentActivity } from './recent-activity.js';
// DOCX/PDF tools (both workspace modes)
import {
  UPLOAD_DOC_FILE_TOOL, uploadDocFile,
  EXPORT_DOC_TOOL, exportDoc,
  GET_DOC_SOURCE_FILE_TOOL, getDocSourceFile,
} from './document-files.js';

/**
 * The production tool catalog. The MCP server reads this on each request
 * to build its tools/list response and to dispatch tools/call.
 *
 * Order matters subtly — Claude reads the catalog in the order returned,
 * and the description copy reinforces a primary flow:
 *
 *     search_docs (discover) → get_doc / get_doc_section (fetch)
 *
 * Putting search_docs first nudges the model toward that flow when both
 * search_docs and list_docs would technically work. list_docs stays a
 * separate tool because "show me all my docs" is a different intent than
 * "find docs about X" — both are legitimate.
 *
 * Phase 11 changes:
 *   - get_flow_step removed from here; re-registered in server.ts as an App
 *     tool via registerAppTool (adds Walk Simulator UI panel). Chunk A.
 *   - 7 direct-write tools removed from model visibility (Chunk B). They
 *     bypass the propose/commit pattern and must no longer be model-callable.
 *     Their handler functions remain importable for commit handlers:
 *       appendBlocksToDoc, createDoc, replaceDocSection, replaceDocBody,
 *       trashDoc, trashFolder, publishFlow.
 *
 * Phase 12 changes:
 *   - get_flow removed from here; re-registered in server.ts as an App tool
 *     via registerAppTool (adds Flow Builder Canvas UI panel). Chunk A.
 *     getFlow handler stays importable (used by commit handlers if needed).
 */

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: object;
  /** MCP tool annotations for directory submission compliance. */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    title?: string;
  };
}

interface ToolDescriptor {
  spec: McpToolSpec;
  handler: (ctx: McpAuthContext, args: Record<string, unknown>) => Promise<unknown>;
}

export const PRODUCTION_TOOLS: readonly ToolDescriptor[] = [
  { spec: SEARCH_DOCS_TOOL, handler: searchDocs },
  { spec: LIST_DOCS_TOOL, handler: listDocs },
  { spec: GET_DOC_TOOL, handler: getDoc },
  { spec: GET_DOC_SECTION_TOOL, handler: getDocSection },
  // Phase 6.1: list_flows returns published flows in the workspace.
  // get_flow_step is registered in server.ts as an App tool (Phase 11 Chunk A).
  { spec: LIST_FLOWS_TOOL, handler: listFlows },
  // Phase 9.3: folder organisation — 1 read + 3 non-destructive write tools.
  // create_folder, move_doc, move_folder, rename_folder are safe direct writes.
  // trash_folder is routed through propose/commit (removed from model here — Phase 11 Chunk B).
  { spec: LIST_FOLDERS_TOOL, handler: listFolders },
  { spec: CREATE_FOLDER_TOOL, handler: createFolder },
  { spec: MOVE_DOC_TOOL, handler: moveDoc },
  { spec: MOVE_FOLDER_TOOL, handler: moveFolder },
  { spec: RENAME_FOLDER_TOOL, handler: renameFolder },
  // Phase 9.4: flow writes — structural write tools.
  // get_flow re-registered in server.ts as App tool (Phase 12 Chunk A).
  // get_flow_step re-registered in server.ts as App tool (Phase 11 Chunk A).
  // publish_flow routed through propose/commit (removed Phase 11 Chunk B).
  { spec: CREATE_FLOW_TOOL, handler: createFlow },
  { spec: ADD_FLOW_NODE_TOOL, handler: addFlowNode },
  { spec: UPDATE_FLOW_NODE_TOOL, handler: updateFlowNode },
  { spec: REMOVE_FLOW_NODE_TOOL, handler: removeFlowNode },
  { spec: CONNECT_FLOW_NODES_TOOL, handler: connectFlowNodes },
  { spec: REMOVE_FLOW_EDGE_TOOL, handler: removeFlowEdge },
  // Phase 9.5: notify_members — sends in-app notifications to workspace members.
  { spec: NOTIFY_MEMBERS_TOOL, handler: notifyMembers },
  // Sprint 4 E.1-E.2: project tools — available in both workspace modes.
  { spec: LIST_PROJECTS_TOOL, handler: listProjects },
  { spec: GET_PROJECT_TOOL, handler: getProject },
  // Meeting identity: who the request is acting as + their org role/team/access.
  { spec: WHOAMI_TOOL, handler: whoami },
  { spec: REQUEST_DOC_ACCESS_TOOL, handler: requestDocAccess },
  { spec: RECORD_DECISION_TOOL, handler: recordDecisionTool },  // Decision Memory MD1
  // Cross-entity "what changed recently" feed (docs + tasks + meetings, time-sorted).
  { spec: LIST_RECENT_ACTIVITY_TOOL, handler: listRecentActivity },
  // DOCX/PDF file tools — available in both workspace modes.
  { spec: UPLOAD_DOC_FILE_TOOL, handler: uploadDocFile },
  { spec: EXPORT_DOC_TOOL, handler: exportDoc },
  { spec: GET_DOC_SOURCE_FILE_TOOL, handler: getDocSourceFile },
];

export function listToolSpecs(): McpToolSpec[] {
  return PRODUCTION_TOOLS.map((t) => t.spec);
}

export function findTool(name: string): ToolDescriptor | undefined {
  return PRODUCTION_TOOLS.find((t) => t.spec.name === name);
}
