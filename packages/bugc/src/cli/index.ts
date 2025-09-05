/**
 * CLI module exports
 */

export { handleCompileCommand } from "./compile.js";
export { formatJson, formatIrText } from "./formatters.js";
export {
  commonOptions,
  optimizationOption,
  parseOptimizationLevel,
} from "./options.js";
export {
  displayErrors,
  displayWarnings,
  writeOutput,
  exitWithError,
} from "./output.js";
export { formatError, formatWarning } from "./error-formatter.js";
