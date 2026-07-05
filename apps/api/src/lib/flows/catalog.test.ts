import { describe, expect, it } from 'vitest';
import { findTool, listToolSpecs, PRODUCTION_TOOLS } from '../../mcp/tools/index.js';
import { GET_FLOW_STEP_TOOL } from '../../mcp/tools/get-flow-step.js';
import { LIST_FLOWS_TOOL } from '../../mcp/tools/list-flows.js';

/**
 * Phase 6.1 contract checks for the MCP tool catalog. These don't invoke
 * the handlers (which need a tenant + DB), but they assert the registry
 * looks right and the descriptions no longer carry the Phase 5
 * "preview / coming next release" language.
 */
describe('MCP tool catalog (Phase 6.1)', () => {
  it('registers list_flows and get_flow_step alongside the doc tools', () => {
    const names = PRODUCTION_TOOLS.map((t) => t.spec.name);
    expect(names).toEqual([
      'search_docs',
      'list_docs',
      'get_doc',
      'get_doc_section',
      'list_flows',
      'get_flow_step',
    ]);
    expect(listToolSpecs()).toHaveLength(6);
    expect(findTool('list_flows')?.spec.name).toBe('list_flows');
    expect(findTool('get_flow_step')?.spec.name).toBe('get_flow_step');
  });

  it('list_flows description no longer carries Phase 5 preview language', () => {
    const d = LIST_FLOWS_TOOL.description.toLowerCase();
    expect(d).not.toContain('preview');
    expect(d).not.toContain('returns an empty list');
    expect(d).not.toContain('coming in the next release');
    // And does mention what to do next (call get_flow_step on each item):
    expect(d).toContain('get_flow_step');
  });

  it('get_flow_step requires flow_id and step_index', () => {
    expect(GET_FLOW_STEP_TOOL.inputSchema.required).toEqual([
      'flow_id',
      'step_index',
    ]);
    const d = GET_FLOW_STEP_TOOL.description.toLowerCase();
    expect(d).not.toContain('preview');
    expect(d).not.toContain('coming in the next release');
  });
});
