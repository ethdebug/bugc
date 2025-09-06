/**
 * EVM instruction formatting utilities
 */

import type { Instruction } from "#evm/spec";

/**
 * Formats EVM instructions for display
 */
export class EvmFormatter {
  /**
   * Format instruction objects as assembly text
   */
  static formatInstructions(instructions: Instruction[]): string {
    let offset = 0;
    return instructions
      .map((inst) => {
        let line = `${offset.toString().padStart(4, "0")}: ${inst.mnemonic}`;
        if (inst.immediates && inst.immediates.length > 0) {
          const dataHex = inst.immediates
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          line += ` 0x${dataHex}`;
        }

        // Update offset for next instruction
        offset += 1 + (inst.immediates?.length || 0);

        return line;
      })
      .join("\n");
  }
}
