import type { McpPromptDefinition, McpPromptMessage } from './types'

export const MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: 'trace_plan_image',
    description:
      'Trace rooms, wall types, and openings from a floorplan image into a Simple Floorplan project, then visually verify with an SVG overlay.',
    arguments: [
      { name: 'projectId', description: 'Target project ID (or leave empty to create a new project).', required: false },
      { name: 'notes', description: 'Optional context such as known scale, room names, or wall thicknesses.', required: false },
    ],
  },
  {
    name: 'finish_survey',
    description:
      'Guide an on-site laser-measure survey in walking order, flag discrepancies and out-of-square rooms, and offer to apply verified lengths.',
    arguments: [
      { name: 'projectId', description: 'Project ID to audit.', required: true },
      { name: 'roomCode', description: 'Optional room code (e.g. "CU") to focus on one room.', required: false },
    ],
  },
  {
    name: 'renovation_option',
    description:
      'Evaluate knocking down a partition wall between two rooms: verify it is not bearing, preview merge_rooms with dryRun, and report new areas and removed elements.',
    arguments: [
      { name: 'projectId', description: 'Project ID.', required: true },
      { name: 'roomCodes', description: 'Comma-separated pair of room codes, e.g. "SE,CU".', required: false },
    ],
  },
  {
    name: 'contractor_export',
    description:
      'Validate plan readiness for a contractor or kitchen planner, flag blockers (element overflows, missing ceilings, discrepancies), and generate a summary and SVG.',
    arguments: [
      { name: 'projectId', description: 'Project ID.', required: true },
      { name: 'roomCode', description: 'Optional room code to focus the handoff on (e.g. "CU").', required: false },
    ],
  },
]

export function getPrompt(
  name: string,
  args: Record<string, string> = {},
): { description: string; messages: McpPromptMessage[] } | null {
  const def = MCP_PROMPTS.find((p) => p.name === name)
  if (!def) return null

  const projectRef = args.projectId ? `project "${args.projectId}"` : 'a project (call list_projects or create_project first)'

  switch (name) {
    case 'trace_plan_image': {
      const extra = args.notes ? `\nUser notes: ${args.notes}` : ''
      return {
        description: def.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Trace the floorplan image into ${projectRef}. Follow these steps:\n` +
                `1. Inspect the current plan with get_plan (format: "json") to check if a calibrated background image or rooms already exist.\n` +
                `2. Remember world units are centimeters (cm), x right, y down. Use clear 2-3 character room codes (e.g. EN, SE, CU, C1, SDB).\n` +
                `3. Add rooms using add_room (rect or polygon vertices) or a single run_commands batch. Use slice_room for adjacent spaces that share a straight wall.\n` +
                `4. Mark thick structural walls with set_wall_props (bearing 25 cm, exterior 30 cm, partition 10 cm).\n` +
                `5. Place doors, windows, openings, and radiators with place_element using survey wall labels (CODE-1..n).\n` +
                `   Built-in storage (a closet) is OUTSIDE a room, behind one of its walls: add it with add_storage (room, wall, offsetCm, widthCm, depthCm, optional sideCm, backCm, door), then update_storage or delete_storage. Storage INSIDE a room is furniture: it is not supported.\n` +
                `6. Run validate_plan and render_svg (with background: true if a background image is attached) to verify alignment, and report room areas plus total indoor/outdoor m².` +
                extra,
            },
          },
        ],
      }
    }

    case 'finish_survey': {
      const scope = args.roomCode ? ` Focus on room ${args.roomCode}.` : ''
      return {
        description: def.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Audit the on-site measurement survey for ${projectRef}.${scope}\n` +
                `1. Call get_unmeasured${args.roomCode ? ` with roomCode: "${args.roomCode}"` : ''} to list remaining wall lengths (CODE-1..n), diagonals (CODE-D), and ceiling heights (CODE-H) in walking order.\n` +
                `2. Call validate_plan${args.roomCode ? ` with roomCode: "${args.roomCode}"` : ''} to identify discrepancies (> 2 cm), out-of-square rooms, opposite-wall mismatches, and element overflows.\n` +
                `3. Present a concise checklist grouped by room, highlighting items to re-check on site.\n` +
                `4. When the user provides new readings, save them with set_measurement (or run_commands batch), report updated progress, and offer to preview apply_measurements with dryRun: true before committing.`,
            },
          },
        ],
      }
    }

    case 'renovation_option': {
      const pair = args.roomCodes ? ` between rooms ${args.roomCodes}` : ''
      return {
        description: def.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Evaluate a wall-removal renovation option${pair} in ${projectRef}.\n` +
                `1. Call find_shared_walls to inspect the wall(s) separating the target rooms.\n` +
                `2. If any shared wall is marked "bearing", STOP immediately and warn the user that a structural engineer is required. Do NOT pass allowBearingRemoval: true unless the user explicitly instructs you to simulate it.\n` +
                `3. If the shared wall is a partition, call merge_rooms with dryRun: true first.\n` +
                `4. Report: before areas (each room and sum), after area, reclaimed area delta (m²), and any doors/elements removed on the shared wall.\n` +
                `5. Ask the user for confirmation before calling merge_rooms with dryRun: false, then call render_svg to show the updated layout.`,
            },
          },
        ],
      }
    }

    case 'contractor_export': {
      const scope = args.roomCode ? ` Focus on room ${args.roomCode}.` : ''
      return {
        description: def.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Prepare a contractor handoff package for ${projectRef}.${scope}\n` +
                `1. Call validate_plan${args.roomCode ? ` with roomCode: "${args.roomCode}"` : ''} and check for blockers: element overflows, overlapping elements, self-intersections, or large measurement discrepancies.\n` +
                `2. Call get_plan (format: "summary") to gather floor area, perimeter, baseboard length, net wall area, paint estimate, and any missing ceiling heights.\n` +
                `3. Call get_unmeasured${args.roomCode ? ` with roomCode: "${args.roomCode}"` : ''} to list any still-estimated dimensions that should carry a disclaimer.\n` +
                `4. Call render_svg to produce the vector drawing.\n` +
                `5. Summarize blockers first, then provide the clean dimension & material takeoff table and the SVG render link.`,
            },
          },
        ],
      }
    }

    default:
      return null
  }
}
