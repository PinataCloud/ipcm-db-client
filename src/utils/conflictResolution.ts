import { DbVersionManifest } from "./dbVersioning";

export async function resolveConflicts(
  localVersion: DbVersionManifest | null,
  remoteVersion: DbVersionManifest
): Promise<boolean> {
  // If no local version exists, always use remote
  if (!localVersion) return true;

  // If versions are the same, no conflict
  if (localVersion.cid === remoteVersion.cid) return false;

  // If they have a direct lineage relationship
  if (localVersion.cid === remoteVersion.prevVersion ||
    remoteVersion.cid === localVersion.prevVersion) {
    // Choose the later version based on blockchain timestamp
    return remoteVersion.blockTimestamp > localVersion.blockTimestamp;
  }

  // For more complex conflicts (branch merges)
  // Use block timestamp as the source of truth
  return remoteVersion.blockTimestamp > localVersion.blockTimestamp;
}

// export async function mergeChanges(
//   db: PGlite,
//   localChanges: any[],
//   remoteChanges: any[]
// ): Promise<void> {
//   // This would be a more complex implementation based on your specific needs
//   // Could involve diffing the two databases and applying changes selectively

//   // For now, just perform a simple last-writer-wins strategy
//   // In a real implementation, you'd need transaction-level merging
// }
