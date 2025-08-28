/**
 * Liveness analysis pass for BUG compiler
 *
 * Analyzes which values are "live" (will be used) at each point in the program.
 * This information is used by subsequent passes like memory planning and
 * register allocation.
 */

export * from "./liveness";
export * from "./pass";

// Re-export main types for convenience
export type { LivenessInfo } from "./liveness";
