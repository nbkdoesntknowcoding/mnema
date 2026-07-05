import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Hand a Fastify request off to the MCP SDK's Streamable HTTP transport.
 *
 * Phase 10: updated type signature from low-level `Server` to `McpServer`
 * (the high-level wrapper used since the Phase 10 migration). `McpServer`
 * exposes `.connect(transport)` and `.close()` directly; the underlying
 * low-level `Server` is available at `.server` if needed elsewhere.
 *
 * `server` is built and configured by the caller (the route handler in
 * plugin.ts) so the per-request auth context can be captured in the
 * McpServer's handler closures BEFORE the transport hands the first message
 * to the server. Building the server here would mean the context would
 * have to be threaded through this module — which would make the wrong
 * thing easier to do.
 *
 * `reply.hijack()` detaches Fastify's reply pipeline so the SDK can write
 * directly to the underlying ServerResponse.
 */
export async function handleStreamableHttp(
  req: FastifyRequest,
  reply: FastifyReply,
  server: McpServer,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    // Stateless: SDK will not allocate or echo a session ID.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Tear down both sides when the underlying socket closes — prevents
  // accumulating dead transport instances on aborted connections.
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);

  // Detach Fastify's reply pipeline so the SDK can write directly.
  reply.hijack();

  await transport.handleRequest(req.raw, reply.raw, req.body);
}
