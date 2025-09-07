#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * CLI tool to inspect storage of BUG contracts using debug info
 */

import { readFileSync } from "fs";
import { resolve } from "path";
// Debug compilation not yet available in new interface
import * as Format from "@ethdebug/format";
import { CliBase, type BaseCliOptions } from "../src/cli-base.js";
import { StorageDecoder } from "./storage-decoder.js";

interface StorageOptions extends BaseCliOptions {
  address?: string;
  "debug-info"?: string;
  source?: string;
  slot?: string;
  raw?: boolean;
}

interface DebugInfo {
  types: Record<string, Format.Type>;
  programs:
    | Array<{
        contract?: {
          name: string;
        };
        environment?: string;
        context?: {
          variables?: Array<{
            identifier: string;
            type: { id: string };
            pointer: Format.Pointer;
          }>;
          gather?: Array<{
            variables?: Array<{
              identifier: string;
              type: { id: string };
              pointer: Format.Pointer;
            }>;
          }>;
        };
      }>
    | {
        main?: {
          context?: {
            variables?: Array<{
              identifier: string;
              type: { id: string };
              pointer: Format.Pointer;
            }>;
            gather?: Array<{
              variables?: Array<{
                identifier: string;
                type: { id: string };
                pointer: Format.Pointer;
              }>;
            }>;
          };
        };
      };
}

class StorageCli extends CliBase<StorageOptions> {
  private decoder: StorageDecoder;

  constructor() {
    super({
      name: "bug-storage",
      description: "Inspect storage of BUG contracts using debug info",
      options: {
        address: {
          type: "string",
          required: true,
          description: "Contract address to inspect",
        },
        "debug-info": {
          type: "string",
          description: "Path to debug info JSON file",
        },
        source: {
          type: "string",
          description: "BUG source file (compile and inspect)",
        },
        slot: {
          type: "string",
          description: "Query specific storage slot",
        },
        raw: {
          type: "boolean",
          default: false,
          description: "Show raw hex values only",
        },
      },
      examples: [
        "bug-storage --address 0x5FbDB2315678afecb367f032d93F642f64180aa3 --debug-info counter.debug.json",
        "bug-storage --address 0x5FbDB2315678afecb367f032d93F642f64180aa3 --source counter.bug",
        "bug-storage --address 0x5FbDB2315678afecb367f032d93F642f64180aa3 --slot 0",
      ],
    });
    this.decoder = new StorageDecoder();
  }

  protected shouldShowHelp(): boolean {
    return this.values.help || !this.values.address;
  }

  protected validateArgs(): void {
    if (!this.values.address) {
      throw new Error("Contract address (--address) is required");
    }
  }

  protected async execute(): Promise<void> {
    // Validate contract exists
    const code = await this.client.eth_getCode(this.values.address!);
    if (code === "0x") {
      throw new Error(`No contract at address ${this.values.address}`);
    }

    console.log(`Inspecting storage at: ${this.values.address}`);
    console.log(`Contract code size: ${(code.length - 2) / 2} bytes\n`);

    // Handle specific slot query
    if (this.values.slot !== undefined) {
      await this.querySlot(this.values.slot);
      return;
    }

    // Load debug info
    const debugInfo = await this.loadDebugInfo();

    if (!debugInfo) {
      console.error("No debug info available. Use --debug-info or --source");
      console.log("\nShowing raw storage (first 10 slots):");

      for (let i = 0; i < 10; i++) {
        const slot = this.client.padHex(this.client.decimalToHex(i));
        const value = await this.client.eth_getStorageAt(this.values.address!, slot);
        if (!this.decoder.isZeroValue(value)) {
          console.log(`  Slot ${i}: ${value}`);
        }
      }
      return;
    }

    // Extract and display storage variables
    await this.displayStorageVariables(debugInfo);
  }

  private async querySlot(slot: string): Promise<void> {
    const slotHex = slot.startsWith("0x")
      ? slot
      : "0x" + BigInt(slot).toString(16);
    const value = await this.client.eth_getStorageAt(this.values.address!, slotHex);
    console.log(`Slot ${slot}: ${value}`);

    if (!this.values.raw && !this.decoder.isZeroValue(value)) {
      const decoded = this.decoder.decodeStorageValue(value, {
        kind: "uint",
        bits: 256,
      });
      console.log(`Decoded: ${decoded}`);
    }
  }

  private async loadDebugInfo(): Promise<DebugInfo | null> {
    if (this.values["debug-info"]) {
      // Load from file
      const debugPath = resolve(this.values["debug-info"]);
      console.log(`Loading debug info from: ${debugPath}`);
      return JSON.parse(readFileSync(debugPath, "utf-8"));
    } else if (this.values.source) {
      // Compile source
      const sourcePath = resolve(this.values.source);
      console.log(`Compiling ${sourcePath}...`);

      // Debug compilation is not yet available in the new interface
      console.error("Debug compilation from source not yet available");
      console.error("Please use --debug-info with a pre-generated debug file");
      process.exit(1);
    }
    return null;
  }

  private async displayStorageVariables(debugInfo: DebugInfo): Promise<void> {
    // Extract storage variables from debug info
    let variables: Array<{
      identifier: string;
      type: { id: string };
      pointer: Format.Pointer;
    }> = [];

    if (Array.isArray(debugInfo.programs)) {
      // Handle array format (from compile-debug output)
      const mainProgram =
        debugInfo.programs.find((p) => p.environment === "call") ||
        debugInfo.programs[0];

      // Check if context has variables directly
      if (mainProgram?.context?.variables) {
        variables = mainProgram.context.variables;
      } else if (mainProgram?.context?.gather) {
        // Handle gather context structure
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const gatherArray = mainProgram.context.gather as Array<any>;
        const variablesContext = gatherArray.find(item => item.variables);
        if (variablesContext?.variables) {
          variables = variablesContext.variables;
        }
      }
    } else {
      // Handle object format (from saved debug info)
      const mainContext = debugInfo.programs.main?.context;
      if (mainContext?.variables) {
        variables = mainContext.variables;
      } else if (mainContext?.gather) {
        // Handle gather context structure
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const gatherArray = mainContext.gather as Array<any>;
        const variablesContext = gatherArray.find(item => item.variables);
        if (variablesContext?.variables) {
          variables = variablesContext.variables;
        }
      }
    }

    const storageVars = variables.filter((v) => {
      // Check if pointer indicates storage location
      const pointer = v.pointer as Format.Pointer & {
        location?: string;
        group?: Array<{ location: string }>;
        list?: { is?: { location?: string } };
      };

      // Check various pointer structures for storage location
      return (
        pointer?.location === "storage" ||
        pointer?.group?.some((p: { location: string }) => p.location === "storage") ||
        pointer?.list?.is?.location === "storage"
      );
    });

    if (storageVars.length === 0) {
      console.log("No storage variables found in debug info");
      return;
    }

    console.log(`Found ${storageVars.length} storage variables:\n`);

    // Query each storage variable
    for (const variable of storageVars) {
      console.log(`${variable.identifier}:`);

      // Get type info
      const typeId = variable.type.id;
      const type = debugInfo.types[typeId];
      if (!type) {
        console.log(`  Type: ${typeId} (not found)`);
        continue;
      }

      console.log(`  Type: ${this.formatType(type)}`);

      // Handle different pointer types
      const pointer = variable.pointer as Format.Pointer & {
        location?: string;
        slot?: number;
        group?: Array<{ location: string; slot: number; name?: string }>;
        list?: {
          count: number;
          each: string;
          is: { slot?: { $sum?: unknown[] } };
        };
      };

      if (pointer.location === "storage" && typeof pointer.slot === "number") {
        // Simple storage pointer
        await this.displayStorageSlot(pointer.slot, type);
      } else if (pointer.group) {
        // Complex type with group pointer
        console.log(`  Structure:`);
        for (const member of pointer.group) {
          if (member.location === "storage" && typeof member.slot === "number") {
            const memberName = member.name || `slot_${member.slot}`;
            console.log(`    ${memberName}:`);
            await this.displayStorageSlot(member.slot, type, "      ");
          }
        }
      } else if (pointer.list) {
        // Array with list pointer
        await this.displayArrayStorage(pointer.list, type);
      }

      console.log();
    }
  }

  private async displayStorageSlot(
    slot: number,
    type: Format.Type,
    indent: string = "  ",
  ): Promise<void> {
    const slotHex = this.client.padHex(this.client.decimalToHex(slot));
    const value = await this.client.eth_getStorageAt(this.values.address!, slotHex);
    console.log(`${indent}Slot: ${slotHex}`);
    console.log(`${indent}Raw: ${value}`);

    if (!this.values.raw && !this.decoder.isZeroValue(value)) {
      try {
        const decoded = this.decoder.decodeStorageValue(value, type);
        const formatted = this.decoder.formatStorageValue(decoded, type);
        console.log(`${indent}Value: ${formatted}`);
      } catch (e) {
        console.log(`${indent}Value: (decode error)`);
      }
    }
  }

  private async displayArrayStorage(
    list: {
      count: number;
      each: string;
      is: { slot?: { $sum?: unknown[] } };
    },
    type: Format.Type,
  ): Promise<void> {
    console.log(`  Array with ${list.count} elements`);
    // For now, just show first few elements
    const count = typeof list.count === "number" ? Math.min(list.count, 5) : 5;
    for (let i = 0; i < count; i++) {
      console.log(`    [${i}]:`);
      // Calculate slot based on expression
      if (list.is?.slot?.$sum) {
        // Handle keccak256(slot) + index pattern
        const baseSlot = this.extractBaseSlot(list.is.slot.$sum);
        if (baseSlot !== null) {
          const elementSlot = this.decoder.computeArraySlot(
            BigInt(baseSlot),
            BigInt(i),
          );
          const slot = this.client.padHex(this.client.decimalToHex(elementSlot));
          const value = await this.client.eth_getStorageAt(this.values.address!, slot);
          console.log(`      Slot: ${slot}`);
          console.log(`      Raw: ${value}`);

          if (!this.values.raw && !this.decoder.isZeroValue(value)) {
            try {
              const decoded = this.decoder.decodeStorageValue(value, type);
              const formatted = this.decoder.formatStorageValue(decoded, type);
              console.log(`      Value: ${formatted}`);
            } catch (e) {
              console.log(`      Value: (decode error)`);
            }
          }
        }
      }
    }
    if (count < list.count) {
      console.log(`    ... ${list.count - count} more elements`);
    }
  }

  private formatType(type: Format.Type): string {
    switch (type.kind) {
      case "uint": {
        const uintType = type as Format.Type.Elementary.Uint;
        return `uint${uintType.bits}`;
      }
      case "int": {
        const intType = type as Format.Type.Elementary.Int;
        return `int${intType.bits}`;
      }
      case "bool":
        return "bool";
      case "address":
        return "address";
      case "bytes": {
        const bytesType = type as Format.Type.Elementary.Bytes;
        return bytesType.size ? `bytes${bytesType.size}` : "bytes";
      }
      case "string":
        return "string";
      case "array":
        return `array`;
      case "mapping":
        return "mapping";
      case "struct":
        return `struct`;
      default:
        return type.kind || "unknown";
    }
  }

  private extractBaseSlot(sumExpr: unknown[]): number | null {
    // Look for keccak256(wordsized(N)) pattern
    for (const expr of sumExpr) {
      const exprObj = expr as { $keccak256?: Array<{ $wordsized?: number }> };
      if (exprObj.$keccak256?.[0]?.$wordsized !== undefined) {
        return exprObj.$keccak256[0].$wordsized;
      }
    }
    return null;
  }
}

const cli = new StorageCli();
cli.run();
