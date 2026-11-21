// Project-title sync (own routes file for the "fixes" agent — see .agent-results/tasks/fixes.md item 1).
// Bug: GET /api/projects kept showing the old projects.title (e.g. "New apartment") after the
// plan title changed, because nothing updated the projects row when a snapshot was saved.
// Fix: when a snapshot is saved, the server copies the snapshot title into projects.title
// (and into projects.name when the name is still a default placeholder).
//
// This file holds the pure decision logic (unit-tested) plus the small D1 write.
// No new HTTP routes are needed: functions/api/[[route]].ts imports `syncProjectTitle`
// and calls it from the snapshot PUT handler (one import line, no mount line).

/** Names that count as "default" placeholders: replaced by the snapshot title. */
export const DEFAULT_PROJECT_NAMES: ReadonlySet<string> = new Set(['New project', 'New apartment'])

export type ProjectTitleRow = { name: string; title: string | null }

/**
 * Pure part: compute the projects-row update implied by a saved snapshot title.
 * Returns null when there is nothing to change (missing/empty title, or title unchanged).
 * `name` is only replaced when it is still a default placeholder.
 */
export function projectTitleUpdate(
  current: ProjectTitleRow | null | undefined,
  snapshotTitle: unknown,
): { name: string; title: string } | null {
  if (!current || typeof snapshotTitle !== 'string') return null
  const title = snapshotTitle.trim()
  if (!title || title === current.title) return null
  const name = DEFAULT_PROJECT_NAMES.has(current.name.trim()) ? title : current.name
  return { name, title }
}

/**
 * Keep projects.title (and a default projects.name) in sync with the just-saved snapshot title.
 * Always bumps updated_at, like the previous handler did.
 */
export async function syncProjectTitle(
  db: D1Database,
  projectId: string,
  snapshotTitle: unknown,
  nowIso: string,
): Promise<void> {
  const row = await db
    .prepare('SELECT name, title FROM projects WHERE id = ?')
    .bind(projectId)
    .first<ProjectTitleRow>()
  const upd = projectTitleUpdate(row, snapshotTitle)
  if (upd) {
    await db
      .prepare('UPDATE projects SET name = ?, title = ?, updated_at = ? WHERE id = ?')
      .bind(upd.name, upd.title, nowIso, projectId)
      .run()
  } else {
    await db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(nowIso, projectId).run()
  }
}
