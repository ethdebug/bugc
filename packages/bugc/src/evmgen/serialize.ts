/**
 * Serialization module for converting Instructions to raw EVM bytecode
 */

import type { Instruction } from "../evm/operations";

/**
 * Convert an array of Instructions to raw bytecode bytes
 */
export function serialize(instructions: Instruction[]): number[] {
  const bytes: number[] = [];

  for (const instruction of instructions) {
    // Add the opcode
    bytes.push(instruction.opcode);

    // Add any immediates
    if (instruction.immediates) {
      bytes.push(...instruction.immediates);
    }
  }

  return bytes;
}

/**
 * Calculate the size in bytes that an instruction will occupy
 */
export function instructionSize(instruction: Instruction): number {
  let size = 1; // opcode

  if (instruction.immediates) {
    size += instruction.immediates.length;
  }

  return size;
}

/**
 * Calculate total size of multiple instructions
 */
export function calculateSize(instructions: Instruction[]): number {
  return instructions.reduce((acc, inst) => acc + instructionSize(inst), 0);
}

/**
 * Serialize with offset tracking for debug information
 */
export function serializeWithOffsets(instructions: Instruction[]): {
  bytes: number[];
  offsets: Map<number, number>; // instruction index -> byte offset
} {
  const bytes: number[] = [];
  const offsets = new Map<number, number>();

  let currentOffset = 0;

  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];

    // Record offset for this instruction
    offsets.set(i, currentOffset);

    // Add the opcode
    bytes.push(instruction.opcode);
    currentOffset++;

    // Add any immediates
    if (instruction.immediates) {
      bytes.push(...instruction.immediates);
      currentOffset += instruction.immediates.length;
    }
  }

  return { bytes, offsets };
}
