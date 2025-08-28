/**
 * EVM Bytecode Disassembler
 * Converts bytecode to human-readable assembly
 */

import { OPCODES, OpCode, opcodeToString } from "../opcodes";
import { hexToBytes } from "ethereum-cryptography/utils";

export interface Instruction {
  offset: number;
  opcode: number;
  name: string;
  pushData?: string;
  gas?: number;
}

export class Disassembler {
  /**
   * Disassemble bytecode into instructions
   */
  static disassemble(bytecode: string): Instruction[] {
    const bytes = hexToBytes(bytecode);
    const instructions: Instruction[] = [];
    let offset = 0;

    while (offset < bytes.length) {
      const opcode = bytes[offset];
      const name = opcodeToString(opcode as OpCode);
      const instruction: Instruction = {
        offset,
        opcode,
        name,
      };

      // Handle PUSH instructions
      if (opcode >= OPCODES.PUSH1 && opcode <= OPCODES.PUSH32) {
        const pushBytes = opcode - OPCODES.PUSH1 + 1;
        const dataBytes = bytes.slice(offset + 1, offset + 1 + pushBytes);
        instruction.pushData =
          "0x" +
          Array.from(dataBytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        offset += pushBytes;
      }

      instructions.push(instruction);
      offset++;
    }

    return instructions;
  }

  /**
   * Format disassembled instructions as a string
   */
  static format(instructions: Instruction[]): string {
    return instructions
      .map((inst) => {
        let line = `${inst.offset.toString().padStart(4, "0")}: ${inst.name}`;
        if (inst.pushData) {
          line += ` ${inst.pushData}`;
        }
        return line;
      })
      .join("\n");
  }

  /**
   * Check if bytecode contains a specific pattern
   */
  static containsPattern(bytecode: string, pattern: number[]): boolean {
    const bytes = hexToBytes(bytecode);
    for (let i = 0; i <= bytes.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (bytes[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }

  /**
   * Find all occurrences of a pattern
   */
  static findPattern(bytecode: string, pattern: number[]): number[] {
    const bytes = hexToBytes(bytecode);
    const positions: number[] = [];

    for (let i = 0; i <= bytes.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (bytes[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) positions.push(i);
    }

    return positions;
  }

  /**
   * Validate bytecode structure
   */
  static validate(bytecode: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const instructions = this.disassemble(bytecode);
    const jumpDests = new Set<number>();
    const jumps: Array<{ from: number; to: number }> = [];

    // Collect JUMPDEST locations and JUMP/JUMPI targets
    for (let i = 0; i < instructions.length; i++) {
      const inst = instructions[i];

      if (inst.name === "JUMPDEST") {
        jumpDests.add(inst.offset);
      }

      if ((inst.name === "JUMP" || inst.name === "JUMPI") && i > 0) {
        const prev = instructions[i - 1];
        if (prev.name.startsWith("PUSH") && prev.pushData) {
          const target = parseInt(prev.pushData, 16);
          jumps.push({ from: inst.offset, to: target });
        }
      }
    }

    // Validate all jumps target valid JUMPDESTs
    for (const jump of jumps) {
      if (!jumpDests.has(jump.to)) {
        errors.push(
          `Invalid jump from ${jump.from} to ${jump.to} - no JUMPDEST at target`,
        );
      }
    }

    // Check for unreachable code (simplified)
    // A more sophisticated analysis would trace execution paths

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Estimate gas cost (simplified)
   */
  static estimateGas(bytecode: string): number {
    const instructions = this.disassemble(bytecode);
    let gas = 0;

    for (const inst of instructions) {
      switch (inst.opcode) {
        case OPCODES.STOP:
        case OPCODES.ADD:
        case OPCODES.MUL:
        case OPCODES.SUB:
        case OPCODES.DIV:
        case OPCODES.MOD:
        case OPCODES.LT:
        case OPCODES.GT:
        case OPCODES.EQ:
        case OPCODES.ISZERO:
        case OPCODES.AND:
        case OPCODES.OR:
        case OPCODES.NOT:
        case OPCODES.POP:
          gas += 3;
          break;
        case OPCODES.MLOAD:
        case OPCODES.MSTORE:
          gas += 3;
          break;
        case OPCODES.SLOAD:
          gas += 2100;
          break;
        case OPCODES.SSTORE:
          gas += 20000; // Simplified - actual cost depends on current value
          break;
        case OPCODES.JUMP:
        case OPCODES.JUMPI:
          gas += 8;
          break;
        case OPCODES.JUMPDEST:
          gas += 1;
          break;
        case OPCODES.KECCAK256:
          gas += 30; // Base cost, actual depends on data size
          break;
        default:
          if (inst.opcode >= OPCODES.PUSH1 && inst.opcode <= OPCODES.PUSH32) {
            gas += 3;
          } else if (
            inst.opcode >= OPCODES.DUP1 &&
            inst.opcode <= OPCODES.DUP16
          ) {
            gas += 3;
          } else if (
            inst.opcode >= OPCODES.SWAP1 &&
            inst.opcode <= OPCODES.SWAP16
          ) {
            gas += 3;
          } else {
            gas += 3; // Default
          }
      }
    }

    return gas;
  }
}
