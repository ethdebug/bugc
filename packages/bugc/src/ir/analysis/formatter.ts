/**
 * IR formatter for human-readable text output
 */

import {
  IrModule,
  IrFunction,
  BasicBlock,
  IrInstruction,
  PhiInstruction,
  Value,
  TypeRef,
  Terminator,
} from "../ir.js";

export class IrFormatter {
  private indent = 0;
  private output: string[] = [];

  format(module: IrModule): string {
    this.output = [];
    this.indent = 0;

    // Module declaration with name (no quotes)
    this.line(`module ${module.name} {`);
    this.indent++;

    // Storage layout as first-class declaration
    if (module.storage.slots.length > 0) {
      this.line("storage {");
      this.indent++;
      for (const slot of module.storage.slots) {
        this.line(`[${slot.slot}] ${slot.name}: ${this.formatType(slot.type)}`);
      }
      this.indent--;
      this.line("}");
      this.line("");
    }

    // Format create function first if present
    if (module.create) {
      this.line("@create");
      this.formatFunction(module.create);
      this.line("");
    }

    // Format main function next
    this.line("@main");
    this.formatFunction(module.main);

    // Format user-defined functions last
    if (module.functions && module.functions.size > 0) {
      this.line("");
      for (const func of module.functions.values()) {
        this.formatFunction(func);
        this.line("");
      }
    }

    this.indent--;
    this.line("}");

    return this.output.join("\n");
  }

  private formatFunction(func: IrFunction): void {
    // Format function signature with parameters
    const paramCount = func.paramCount || 0;
    const params: string[] = [];
    for (let i = 0; i < paramCount; i++) {
      const local = func.locals[i];
      params.push(`^${local.id}: ${this.formatType(local.type)}`);
    }
    this.line(`function ${func.name}(${params.join(", ")}) {`);
    this.indent++;

    // Format remaining locals (non-parameters) as first-class declarations
    if (func.locals.length > paramCount) {
      for (let i = paramCount; i < func.locals.length; i++) {
        const local = func.locals[i];
        // Just show ID and type, since ID is already meaningful
        this.line(`local ^${local.id}: ${this.formatType(local.type)}`);
      }
      this.line("");
    }

    // Get blocks in topological order
    const sortedBlocks = this.topologicalSort(func);

    // Format each block
    for (const blockId of sortedBlocks) {
      const block = func.blocks.get(blockId)!;
      this.formatBlock(blockId, block);
    }

    this.indent--;
    this.line("}");
  }

  private formatBlock(id: string, block: BasicBlock): void {
    // Block header - only show predecessors for merge points (multiple preds)
    // or if block has phi nodes (which indicates it's a merge point)
    const showPreds =
      block.predecessors.size > 1 || (block.phis && block.phis.length > 0);
    const predsStr =
      showPreds && block.predecessors.size > 0
        ? ` preds=[${Array.from(block.predecessors).sort().join(", ")}]`
        : "";
    this.line(`${id}${predsStr}:`);
    this.indent++;

    // Phi nodes
    if (block.phis) {
      for (const phi of block.phis) {
        this.line(this.formatPhiInstruction(phi));
      }
    }

    // Instructions
    for (const inst of block.instructions) {
      this.line(this.formatInstruction(inst));
    }

    // Terminator
    this.line(this.formatTerminator(block.terminator));

    this.indent--;
    this.line("");
  }

  private formatPhiInstruction(inst: PhiInstruction): string {
    const sources: string[] = [];
    for (const [block, value] of inst.sources) {
      sources.push(`[${block}: ${this.formatValue(value)}]`);
    }
    // Add appropriate prefix for destinations in phi nodes
    const dest = inst.dest.startsWith("t") ? `%${inst.dest}` : `^${inst.dest}`;
    const typeStr = inst.type ? `: ${this.formatType(inst.type)}` : "";
    return `${dest}${typeStr} = phi ${sources.join(", ")}`;
  }
  private formatInstruction(inst: IrInstruction): string {
    // Helper to add type annotation to dest
    const destWithType = (dest: string, type?: TypeRef): string => {
      // Add appropriate prefix for destinations
      const formattedDest = dest.startsWith("t") ? `%${dest}` : `^${dest}`;
      return type
        ? `${formattedDest}: ${this.formatType(type)}`
        : formattedDest;
    };

    switch (inst.kind) {
      case "const":
        return `${destWithType(inst.dest, inst.type)} = const ${this.formatConstValue(inst.value, inst.type)}`;

      case "load_storage":
        return `${destWithType(inst.dest, inst.type)} = load_storage ${this.formatValue(inst.slot)}`;

      case "store_storage":
        return `store_storage ${this.formatValue(inst.slot)}, ${this.formatValue(inst.value)}`;

      case "load_mapping":
        return `${destWithType(inst.dest, inst.valueType)} = load_mapping slot=${inst.slot}, key=${this.formatValue(inst.key)}`;

      case "store_mapping":
        return `store_mapping slot=${inst.slot}, key=${this.formatValue(inst.key)}, value=${this.formatValue(inst.value)}`;

      case "load_local":
        // Use the local ID with ^ prefix
        return `${destWithType(inst.dest)} = load_local ^${inst.local}`;

      case "store_local":
        // Use the local ID with ^ prefix
        return `store_local ^${inst.local}, ${this.formatValue(inst.value)}`;

      case "load_field":
        return `${destWithType(inst.dest, inst.type)} = load_field object=${this.formatValue(inst.object)}, field="${inst.field}", index=${inst.fieldIndex}`;

      case "store_field":
        return `store_field object=${this.formatValue(inst.object)}, field="${inst.field}", index=${inst.fieldIndex}, value=${this.formatValue(inst.value)}`;

      case "load_index":
        return `${destWithType(inst.dest)} = load_index array=${this.formatValue(inst.array)}, index=${this.formatValue(inst.index)}`;

      case "store_index":
        return `store_index array=${this.formatValue(inst.array)}, index=${this.formatValue(inst.index)}, value=${this.formatValue(inst.value)}`;

      case "slice":
        return `${destWithType(inst.dest)} = slice object=${this.formatValue(inst.object)}, start=${this.formatValue(inst.start)}, end=${this.formatValue(inst.end)}`;

      case "binary":
        return `${destWithType(inst.dest)} = ${inst.op} ${this.formatValue(inst.left)}, ${this.formatValue(inst.right)}`;

      case "unary":
        return `${destWithType(inst.dest)} = ${inst.op} ${this.formatValue(inst.operand)}`;

      case "env":
        return `${destWithType(inst.dest)} = env ${inst.op}`;

      case "hash":
        return `${destWithType(inst.dest)} = hash ${this.formatValue(inst.value)}`;

      case "cast":
        return `${destWithType(inst.dest, inst.targetType)} = cast ${this.formatValue(inst.value)} to ${this.formatType(inst.targetType)}`;

      case "compute_slot":
        return `${destWithType(inst.dest, { kind: "uint", bits: 256 })} = compute_slot base=${this.formatValue(inst.baseSlot)}, key=${this.formatValue(inst.key)}`;

      case "compute_array_slot":
        return `${destWithType(inst.dest, { kind: "uint", bits: 256 })} = compute_array_slot base=${this.formatValue(inst.baseSlot)}`;

      case "compute_field_offset":
        return `${destWithType(inst.dest, { kind: "uint", bits: 256 })} = compute_field_offset base=${this.formatValue(inst.baseSlot)}, field_index=${inst.fieldIndex}`;

      case "call": {
        const args = inst.arguments
          .map((arg) => this.formatValue(arg))
          .join(", ");
        if (inst.dest) {
          // Need to get return type - for now just use unknown
          return `${inst.dest} = call ${inst.function}(${args})`;
        } else {
          return `call ${inst.function}(${args})`;
        }
      }

      case "length":
        return `${destWithType(inst.dest)} = length ${this.formatValue(inst.object)}`;

      default:
        return `; unknown instruction: ${(inst as unknown as { kind: string }).kind}`;
    }
  }

  private formatTerminator(term: Terminator): string {
    switch (term.kind) {
      case "jump":
        return `jump ${term.target}`;

      case "branch":
        return `branch ${this.formatValue(term.condition)} ? ${term.trueTarget} : ${term.falseTarget}`;

      case "return":
        return term.value
          ? `return ${this.formatValue(term.value)}`
          : "return void";

      default:
        return `; unknown terminator: ${(term as unknown as { kind: string }).kind}`;
    }
  }

  private formatValue(
    value: Value | bigint | string | boolean,
    includeType: boolean = false,
  ): string {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "string") {
      // If it's a hex string (starts with 0x), return without quotes
      if (value.startsWith("0x")) {
        return value;
      }
      return JSON.stringify(value);
    }
    if (typeof value === "boolean") {
      return value.toString();
    }

    const baseFormat = (() => {
      switch (value.kind) {
        case "const":
          // Pass type information to formatConstValue for proper hex formatting
          return this.formatConstValue(value.value, value.type);
        case "temp":
          return `%${value.id}`; // Add % prefix for temps for clarity
        case "local":
          // Use the local's name directly
          return value.name;
        default:
          return "?";
      }
    })();

    // Only add type information if requested (to avoid redundancy)
    if (includeType && value.type) {
      const typeStr = this.formatType(value.type);
      return `${baseFormat}: ${typeStr}`;
    }
    return baseFormat;
  }

  private formatConstValue(
    value: bigint | string | boolean,
    type?: TypeRef,
  ): string {
    if (typeof value === "bigint") {
      // If we have type information and it's a bytes type, format as hex
      if (type && type.kind === "bytes") {
        // Convert to hex string with 0x prefix
        const hex = value.toString(16);
        // Pad to even number of characters (2 per byte)
        const padded = hex.length % 2 === 0 ? hex : "0" + hex;
        return `0x${padded}`;
      }
      return value.toString();
    }
    if (typeof value === "string") {
      // If it's already a hex string (starts with 0x), return without quotes
      if (value.startsWith("0x")) {
        return value;
      }
      // Otherwise, use JSON.stringify for proper escaping
      return JSON.stringify(value);
    }
    return value.toString();
  }

  private formatType(type: TypeRef): string {
    switch (type.kind) {
      case "uint":
        return `uint${type.bits}`;
      case "int":
        return `int${type.bits}`;
      case "address":
        return "address";
      case "bool":
        return "bool";
      case "bytes":
        return type.size !== undefined ? `bytes${type.size}` : "bytes";
      case "string":
        return "string";
      case "array":
        return type.size !== undefined
          ? `${this.formatType(type.element)}[${type.size}]`
          : `${this.formatType(type.element)}[]`;
      case "mapping":
        return `mapping<${this.formatType(type.key)} => ${this.formatType(type.value)}>`;
      case "struct":
        return type.name || "struct";
      default:
        return "unknown";
    }
  }

  private line(text: string): void {
    const indentStr = "  ".repeat(this.indent);
    this.output.push(indentStr + text);
  }

  private topologicalSort(func: IrFunction): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (blockId: string): void => {
      if (visited.has(blockId)) return;
      visited.add(blockId);

      const block = func.blocks.get(blockId);
      if (!block) return;

      // Visit successors first (post-order)
      const successors = this.getSuccessors(block);
      for (const succ of successors) {
        visit(succ);
      }

      result.push(blockId);
    };

    // Start from entry
    visit(func.entry);

    // Visit any unreachable blocks
    for (const blockId of func.blocks.keys()) {
      visit(blockId);
    }

    return result.reverse();
  }

  private getSuccessors(block: BasicBlock): string[] {
    switch (block.terminator.kind) {
      case "jump":
        return [block.terminator.target];
      case "branch":
        return [block.terminator.trueTarget, block.terminator.falseTarget];
      case "return":
        return [];
      default:
        return [];
    }
  }
}
