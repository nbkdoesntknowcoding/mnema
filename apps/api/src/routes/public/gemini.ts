/**
 * Gemini function calling integration.
 * GET /api/public/gemini-functions.json — Gemini-compatible function declarations
 */

import type { FastifyPluginAsync } from 'fastify';

const GEMINI_FUNCTIONS = {
  function_declarations: [
    {
      name: 'search_knowledge_base',
      description:
        'Search the Mnema knowledge base for docs matching a query. Use this before answering questions that might be in the team\'s documentation.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          limit: { type: 'integer', description: 'Maximum results to return (default 5, max 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_doc',
      description: 'Retrieve the full content of a specific document by its ID.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: 'The document ID from search results' },
        },
        required: ['doc_id'],
      },
    },
    {
      name: 'list_docs',
      description: 'List all documents in the knowledge base, optionally filtered by folder.',
      parameters: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Filter by folder name (optional)' },
          limit:  { type: 'integer', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'get_flow_step',
      description: 'Walk through a structured flow step by step. Returns one step at a time.',
      parameters: {
        type: 'object',
        properties: {
          flow_slug:   { type: 'string', description: 'The flow identifier' },
          step_index:  { type: 'integer', description: 'Step number starting from 1' },
        },
        required: ['flow_slug', 'step_index'],
      },
    },
    {
      name: 'create_doc',
      description: 'Create a new document in the knowledge base. Requires write scope.',
      parameters: {
        type: 'object',
        properties: {
          title:   { type: 'string' },
          content: { type: 'string', description: 'Document content in markdown format' },
          folder:  { type: 'string', description: 'Target folder name (optional)' },
        },
        required: ['title', 'content'],
      },
    },
  ],
};

export const geminiRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/public/gemini-functions.json — no auth required (schema document)
  app.get('/api/public/gemini-functions.json', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    return GEMINI_FUNCTIONS;
  });
};
