/**
 * EVM Code Generation Module
 *
 * Transforms IR to EVM bytecode with careful stack and memory management.
 */

export { EvmError, EvmErrorCode } from "./errors";
export { generateModule } from "./generator";
