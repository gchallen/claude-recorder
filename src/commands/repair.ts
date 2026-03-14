import { repairOrphanedSessions } from "../repair.js";

export function repairCommand(): void {
  const result = repairOrphanedSessions((msg) => console.log(`  ${msg}`));

  if (result.orphanCount === 0) {
    console.log("No orphaned sessions found.");
  } else {
    console.log(`\nDone! Repaired ${result.repaired} session(s), ${result.notRecoverable} not recoverable.`);
  }
}
