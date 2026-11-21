import { useSyncStatusText } from '../../sync/sync'

/** Text for the status line under the progress bar (real sync state). */
export function useSyncStatus(): string {
  return useSyncStatusText().text
}
