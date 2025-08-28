/**
 * CLI module exports
 */

export { handleCompileCommand } from "./compile";
export { formatJson, formatIrText } from "./formatters";
export {
  commonOptions,
  optimizationOption,
  parseOptimizationLevel,
} from "./options";
export {
  displayErrors,
  displayWarnings,
  writeOutput,
  exitWithError,
} from "./output";
export { formatError, formatWarning } from "./error-formatter";
