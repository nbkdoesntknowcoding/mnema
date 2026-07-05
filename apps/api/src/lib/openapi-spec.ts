/**
 * OpenAPI 3.1 spec for the Mnema public REST API.
 * Auto-serves from GET /api/public/openapi.json and /api/public/openapi.yaml
 *
 * This spec exactly describes the routes in src/routes/public/v1.ts.
 */

export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Mnema Knowledge API',
    description:
      'Access your Mnema workspace docs, flows, and tasks from any AI application.',
    version: '1.0.0',
  },
  servers: [
    { url: 'https://mnema.example.com/api/public/v1' },
  ],
  security: [{ ApiKeyAuth: [] }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Mnema API key. Get from workspace settings → API Keys.',
      },
    },
    schemas: {
      DocSummary: {
        type: 'object',
        properties: {
          id:        { type: 'string', format: 'uuid' },
          title:     { type: 'string' },
          path:      { type: 'string' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'title', 'path', 'updatedAt'],
      },
      DocFull: {
        type: 'object',
        properties: {
          id:        { type: 'string', format: 'uuid' },
          title:     { type: 'string' },
          path:      { type: 'string' },
          markdown:  { type: 'string' },
          updatedAt: { type: 'string', format: 'date-time' },
          truncated: { type: 'boolean' },
        },
        required: ['id', 'title', 'path', 'markdown', 'updatedAt'],
      },
      SearchResult: {
        type: 'object',
        properties: {
          id:      { type: 'string', format: 'uuid' },
          title:   { type: 'string' },
          path:    { type: 'string' },
          preview: { type: 'string' },
          score:   { type: 'number' },
        },
        required: ['id', 'title', 'path', 'preview', 'score'],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code:    { type: 'string' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
      },
      ApiMeta: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          requestId:   { type: 'string' },
          timestamp:   { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/docs': {
      get: {
        operationId: 'listDocs',
        summary: 'List documents',
        description: 'Returns all non-deleted documents in the workspace.',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['gpt'] }, description: 'Pass format=gpt to truncate responses for ChatGPT compatibility' },
        ],
        responses: {
          '200': {
            description: 'Document list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        docs:        { type: 'array', items: { $ref: '#/components/schemas/DocSummary' } },
                        next_cursor: { type: 'string', nullable: true },
                      },
                    },
                    meta: { $ref: '#/components/schemas/ApiMeta' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
      post: {
        operationId: 'createDoc',
        summary: 'Create document',
        description: 'Creates a new document in the workspace. Requires write scope.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title:    { type: 'string' },
                  markdown: { type: 'string' },
                  folderId: { type: 'string', format: 'uuid' },
                },
                required: ['title'],
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/docs/search': {
      get: {
        operationId: 'searchDocs',
        summary: 'Search documents',
        description: 'Hybrid full-text + semantic search across all workspace documents.',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'Natural language search query' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['gpt'] } },
        ],
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        results: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } },
                      },
                    },
                    meta: { $ref: '#/components/schemas/ApiMeta' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/docs/{id}': {
      get: {
        operationId: 'getDoc',
        summary: 'Get document by ID',
        description: 'Returns the full markdown content of a specific document.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['gpt'] } },
        ],
        responses: {
          '200': {
            description: 'Full document',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/DocFull' }, meta: { $ref: '#/components/schemas/ApiMeta' } } } } },
          },
          '404': { description: 'Not found' },
        },
      },
      patch: {
        operationId: 'updateDoc',
        summary: 'Update document',
        description: 'Update the title or full markdown body of a document. Requires write scope.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title:    { type: 'string' },
                  markdown: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated' },
          '403': { description: 'Requires write scope' },
        },
      },
    },
    '/docs/{id}/append': {
      post: {
        operationId: 'appendToDoc',
        summary: 'Append markdown to document',
        description: 'Appends content to the end of an existing document. Requires write scope.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'] },
            },
          },
        },
        responses: { '200': { description: 'Appended' } },
      },
    },
    '/folders': {
      get: {
        operationId: 'listFolders',
        summary: 'List folders',
        responses: { '200': { description: 'Folder list' } },
      },
    },
    '/flows': {
      get: {
        operationId: 'listFlows',
        summary: 'List flows',
        responses: { '200': { description: 'Flow list' } },
      },
    },
    '/flows/{slug}': {
      get: {
        operationId: 'getFlow',
        summary: 'Get flow graph',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Flow graph' }, '404': { description: 'Not found' } },
      },
    },
    '/flows/{slug}/steps/{stepIndex}': {
      get: {
        operationId: 'getFlowStep',
        summary: 'Get single flow step',
        description: 'Returns one step of a structured flow. stepIndex is 1-indexed.',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stepIndex', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
        ],
        responses: { '200': { description: 'Flow step' }, '404': { description: 'Not found' } },
      },
    },
    '/tasks/next': {
      get: {
        operationId: 'getNextTask',
        summary: 'Get next task',
        description: 'Returns the next available task. Requires tasks scope.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', default: 'backlog' } },
        ],
        responses: { '200': { description: 'Task' } },
      },
    },
    '/tasks/{id}/claim': {
      post: {
        operationId: 'claimTask',
        summary: 'Claim a task',
        description: 'Transitions a task from backlog to in_progress. Requires tasks scope.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Updated task' } },
      },
    },
    '/tasks/{id}/complete': {
      post: {
        operationId: 'completeTask',
        summary: 'Complete a task',
        description: 'Marks an in_progress task as done. Requires tasks scope.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { summary: { type: 'string' }, githubPrUrl: { type: 'string' } } },
            },
          },
        },
        responses: { '200': { description: 'Updated task' } },
      },
    },
    '/tasks/{id}/block': {
      post: {
        operationId: 'blockTask',
        summary: 'Block a task',
        description: 'Marks a task as blocked (audit_fix). Triggers retry engine. Requires tasks scope.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] },
            },
          },
        },
        responses: { '200': { description: 'Updated task' } },
      },
    },
    '/call': {
      post: {
        operationId: 'callFunction',
        summary: 'Unified function call dispatcher',
        description: 'Dispatches a named function call. Used by Gemini function calling and other AI apps.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  function:   { type: 'string', description: 'Function name (e.g. search_knowledge_base, get_doc)' },
                  parameters: { type: 'object', description: 'Function parameters' },
                },
                required: ['function'],
              },
            },
          },
        },
        responses: { '200': { description: 'Function result' }, '404': { description: 'Unknown function' } },
      },
    },
  },
} as const;
