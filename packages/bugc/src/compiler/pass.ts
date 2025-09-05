import { Result } from "#result";
import type { BugError } from "#errors";

export type PassConfig = {
  needs: unknown;
  adds: unknown;
  error: BugError;
};

export type Needs<C extends PassConfig> = C["needs"];
export type Adds<C extends PassConfig> = C["adds"];
export type PassError<C extends PassConfig> = C["error"];

export interface Pass<C extends PassConfig = PassConfig> {
  run: Run<C>;
}

/**
 * A compiler pass is a pure function that transforms input to output
 * and may produce messages (errors/warnings)
 */
export type Run<C extends PassConfig> = (
  input: Needs<C>,
) => Promise<Result<Adds<C>, PassError<C>>>;
