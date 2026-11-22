// Hand-written OpenAPI 3.1.0 specification covering all Simple Floorplan API routes.
export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Simple Floorplan API',
    version: '1.0.0',
    description:
      'REST API for Simple Floorplan. World units are centimeters (x right, y down). Survey labels use ROOMCODE-1..n for walls, ROOMCODE-D for diagonal, ROOMCODE-H for ceiling height.',
  },
  servers: [{ url: '/api', description: 'Same-origin API base path' }],
  components: {
    securitySchemes: {
      PasscodeAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-passcode',
        description: 'Required when PASSCODE environment variable is configured on the server.',
      },
    },
    schemas: {
      PlanDocV1: {
        $ref: '/api/schema/plan.v1.json',
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['error'],
      },
      ProjectSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          title: { type: ['string', 'null'] },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'name', 'updatedAt'],
      },
      CommandBatchRequest: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['type'],
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'add_room',
                    'update_room',
                    'delete_room',
                    'slice_room',
                    'cutout_room',
                    'merge_rooms',
                    'set_wall_props',
                    'set_wall_length',
                    'move_vertex',
                    'place_element',
                    'update_element',
                    'delete_element',
                    'set_measurement',
                    'clear_measurement',
                    'apply_measurements',
                    'set_room_note',
                    'add_pin',
                    'add_tape',
                    'set_apartment',
                  ],
                },
              },
              additionalProperties: true,
            },
          },
          dryRun: { type: 'boolean', default: false },
          baseVersion: { type: 'integer', minimum: 0 },
        },
        required: ['commands'],
      },
      QueryRequest: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            enum: ['summary', 'unmeasured', 'validate', 'shared_walls', 'room'],
          },
          args: { type: 'object', additionalProperties: true },
        },
        required: ['query'],
      },
    },
  },
  security: [{ PasscodeAuth: [] }],
  paths: {
    '/openapi.json': {
      get: {
        summary: 'Get OpenAPI 3.1 specification',
        security: [],
        responses: {
          '200': {
            description: 'OpenAPI 3.1 JSON document',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/schema/plan.v1.json': {
      get: {
        summary: 'Get JSON Schema for PlanDoc v1',
        security: [],
        responses: {
          '200': {
            description: 'JSON Schema (draft-2020-12) for PlanDoc v1',
            content: { 'application/schema+json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/share/whoami': {
      get: {
        summary: 'Project and scopes of the calling read-only share token',
        description:
          'Used by the read-only share viewer (/share#<token>): a share token is project-limited, so this returns the project id it may read. Send the token as "Authorization: Bearer sfp_..."; no passcode is needed.',
        responses: {
          '200': {
            description: 'Project id, scopes and capabilities of the calling token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: ['string', 'null'] },
                    scopes: { type: 'array', items: { type: 'string' } },
                    actor: { type: 'string' },
                    viaToken: { type: 'boolean' },
                    canRead: { type: 'boolean' },
                  },
                  required: ['projectId', 'scopes', 'actor', 'viaToken', 'canRead'],
                },
              },
            },
          },
          '401': { description: 'Missing, invalid or revoked token' },
          '403': { description: 'Token has no read scope' },
        },
      },
    },
    '/projects': {
      get: {
        summary: 'List all projects',
        responses: {
          '200': {
            description: 'Array of projects ordered by updatedAt descending',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ProjectSummary' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a new project',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  title: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Project created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProjectSummary' } } },
          },
        },
      },
    },
    '/projects/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        summary: 'Get full project PlanDoc merged with measurements, elements, notes, and version',
        responses: {
          '200': {
            description: 'Merged PlanDoc with version',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '404': { description: 'Project not found' },
        },
      },
      patch: {
        summary: 'Rename project or update title',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' }, title: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Project updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProjectSummary' } } },
          },
          '404': { description: 'Project not found' },
        },
      },
      delete: {
        summary: 'Delete project, all rows, and R2 images',
        responses: {
          '200': { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
          '404': { description: 'Project not found' },
        },
      },
    },
    '/projects/{id}/snapshot': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      put: {
        summary: 'Save a new full snapshot with optimistic concurrency (baseVersion)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['baseVersion'],
                properties: {
                  baseVersion: { type: 'integer', minimum: 0 },
                  schemaVersion: { type: 'integer', const: 1 },
                  title: { type: 'string' },
                  rooms: { type: 'array' },
                  elements: { type: 'array' },
                  tapes: { type: 'array' },
                  pins: { type: 'array' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Snapshot saved', content: { 'application/json': { schema: { type: 'object', properties: { version: { type: 'integer' } } } } } },
          '400': { description: 'Validation error' },
          '409': { description: 'Version conflict' },
        },
      },
    },
    '/projects/{id}/commands': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Optional key to cache and replay command responses.',
        },
      ],
      post: {
        summary: 'Apply one or more high-level floorplan commands atomically (all-or-nothing)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CommandBatchRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Commands applied (or previewed when dryRun=true)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    version: { type: 'integer' },
                    dryRun: { type: 'boolean' },
                    results: { type: 'array', items: { type: 'object' } },
                    warnings: { type: 'array', items: { type: 'object' } },
                    summary: { type: 'object' },
                    doc: { type: 'object', description: 'Included when dryRun is true' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid command or domain error' },
          '404': { description: 'Project not found' },
          '409': { description: 'baseVersion conflict' },
        },
      },
    },
    '/projects/{id}/query': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        summary: 'Run a read-only semantic query (summary, unmeasured, validate, shared_walls, room)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/QueryRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Structured query result',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': { description: 'Invalid query request' },
          '404': { description: 'Project or room not found' },
        },
      },
    },
    '/projects/{id}/render.svg': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        {
          name: 'background',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['0', '1'], default: '0' },
          description: 'Set to 1 to include the calibrated background image in the SVG.',
        },
      ],
      get: {
        summary: 'Render the project floorplan as a standalone SVG',
        responses: {
          '200': {
            description: 'Standalone SVG image (viewBox in cm)',
            content: { 'image/svg+xml': { schema: { type: 'string' } } },
          },
          '404': { description: 'Project not found' },
        },
      },
    },
    '/projects/{id}/measurements/{label}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'label', in: 'path', required: true, schema: { type: 'string' } },
      ],
      put: {
        summary: 'Set a single on-site measurement (last-write-wins)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['actualCm'],
                properties: {
                  actualCm: { type: 'number' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Saved or ignored if stale' } },
      },
      delete: {
        summary: 'Delete a single measurement',
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/projects/{id}/items/{itemId}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      put: {
        summary: 'Upsert a single wall element / survey item (last-write-wins)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Saved or ignored if stale' } },
      },
      delete: {
        summary: 'Soft-delete a wall element / survey item',
        responses: { '200': { description: 'Soft-deleted' } },
      },
    },
    '/projects/{id}/notes/{code}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'code', in: 'path', required: true, schema: { type: 'string' } },
      ],
      put: {
        summary: 'Set a room note by room code (last-write-wins)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: { type: 'string' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Saved or ignored if stale' } },
      },
    },
    '/projects/{id}/changes': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'since', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
      ],
      get: {
        summary: 'Fetch measurements, items, and notes updated after an ISO timestamp',
        responses: { '200': { description: 'Incremental changes' } },
      },
    },
    '/projects/{id}/images': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        summary: 'Upload an image (multipart/form-data field "file") to R2',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Uploaded image key and URL' } },
      },
    },
    '/images/{key}': {
      parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        summary: 'Fetch an uploaded image from R2',
        responses: {
          '200': { description: 'Image bytes' },
          '404': { description: 'Not found' },
        },
      },
    },
  },
} as const
