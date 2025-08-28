/**
 * IR formatter for human-readable text output
 */

import {
  IrModule,
  IrFunction,
  BasicBlock,
  IrInstruction,
  Value,
  TypeRef,
  Terminator,
} from "../ir";

export class IrFormatter {
  private indent = 0;
  private output: string[] = [];

  format(module: IrModule): string {
    this.output = [];
    this.indent = 0;

    this.line(`// BUG-IR Module: ${module.name}`);
    this.line("");

    // Format storage layout
    if (module.storage.slots.length > 0) {
      this.line("// Storage Layout:");
      for (const slot of module.storage.slots) {
        this.line(
          `//   [${slot.slot}] ${slot.name}: ${this.formatType(slot.type)}`,
        );
      }
      this.line("");
    }

    // Format user-defined functions
    if (module.functions && module.functions.size > 0) {
      for (const func of module.functions.values()) {
        this.formatFunction(func);
        this.line("");
      }
    }

    // Format create function if present
    if (module.create) {
      this.formatFunction(module.create);
      this.line("");
    }

    // Format main function
    this.formatFunction(module.main);

    return this.output.join("\n");
  }

  private formatFunction(func: IrFunction): void {
    this.line(`function ${func.name}() {`);
    this.indent++;

    // Format locals
    if (func.locals.length > 0) {
      this.line("// Locals:");
      for (const local of func.locals) {
        this.line(`//   ${local.name}: ${this.formatType(local.type)}`);
      }
      this.line("");
    }

    // Get blocks in topological order
    const sortedBlocks = this.topologicalSort(func);

    // Format each block
    for (const blockId of sortedBlocks) {
      const block = func.blocks.get(blockId)!;
      this.formatBlock(blockId, block, blockId === func.entry);
    }

    this.indent--;
    this.line("}");
  }

  private formatBlock(id: string, block: BasicBlock, isEntry: boolean): void {
    // Block header
    this.line(`${id}:${isEntry ? "  // entry point" : ""}`);
    this.indent++;

    // Predecessor comment
    if (block.predecessors.size > 0 && !isEntry) {
      const preds = Array.from(block.predecessors).sort().join(", ");
      this.line(`// from: ${preds}`);
    }

    // Phi nodes
    if (block.phis) {
      for (const phi of block.phis) {
        this.line(this.formatInstruction(phi));
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

  private formatInstruction(inst: IrInstruction): string {
    switch (inst.kind) {
      case "const":
        return `${inst.dest} = ${this.formatConstValue(inst.value)}`;

      case "load_storage":
        return `${inst.dest} = load storage[${this.formatValue(inst.slot)}]`;

      case "store_storage":
        return `store storage[${this.formatValue(inst.slot)}] = ${this.formatValue(inst.value)}`;

      case "load_mapping":
        return `${inst.dest} = load storage[${inst.slot}][${this.formatValue(inst.key)}]`;

      case "store_mapping":
        return `store storage[${inst.slot}][${this.formatValue(inst.key)}] = ${this.formatValue(inst.value)}`;

      case "load_local":
        return `${inst.dest} = load ${inst.local}`;

      case "store_local":
        return `store ${inst.local} = ${this.formatValue(inst.value)}`;

      case "load_field":
        return `${inst.dest} = load ${this.formatValue(inst.object)}.${inst.field}`;

      case "store_field":
        return `store ${this.formatValue(inst.object)}.${inst.field} = ${this.formatValue(inst.value)}`;

      case "load_index":
        return `${inst.dest} = load ${this.formatValue(inst.array)}[${this.formatValue(inst.index)}]`;

      case "store_index":
        return `store ${this.formatValue(inst.array)}[${this.formatValue(inst.index)}] = ${this.formatValue(inst.value)}`;

      case "slice":
        return `${inst.dest} = slice ${this.formatValue(inst.object)}[${this.formatValue(inst.start)}:${this.formatValue(inst.end)}]`;

      case "binary":
        return `${inst.dest} = ${this.formatBinaryOp(inst.op)} ${this.formatValue(inst.left)}, ${this.formatValue(inst.right)}`;

      case "unary":
        return `${inst.dest} = ${this.formatUnaryOp(inst.op)} ${this.formatValue(inst.operand)}`;

      case "env":
        return `${inst.dest} = ${inst.op}`;

      case "hash":
        return `${inst.dest} = keccak256 ${this.formatValue(inst.value)}`;

      case "cast":
        return `${inst.dest} = cast ${this.formatValue(inst.value)} to ${this.formatType(inst.targetType)}`;

      case "compute_slot":
        return `${inst.dest} = compute_slot(base: ${this.formatValue(inst.baseSlot)}, key: ${this.formatValue(inst.key)})`;

      case "compute_array_slot":
        return `${inst.dest} = compute_array_slot(base: ${this.formatValue(inst.baseSlot)})`;

      case "compute_field_offset":
        return `${inst.dest} = compute_field_offset(base: ${this.formatValue(inst.baseSlot)}, field: ${inst.fieldIndex})`;

      case "call": {
        const args = inst.arguments
          .map((arg) => this.formatValue(arg))
          .join(", ");
        if (inst.dest) {
          return `${inst.dest} = call ${inst.function}(${args})`;
        } else {
          return `call ${inst.function}(${args})`;
        }
      }

      case "length":
        return `${inst.dest} = length ${this.formatValue(inst.object)}`;

      case "phi": {
        const sources: string[] = [];
        for (const [block, value] of inst.sources) {
          sources.push(`[${this.formatValue(value)}, ${block}]`);
        }
        return `${inst.dest} = phi ${sources.join(", ")}`;
      }

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

  private formatValue(value: Value | bigint | string | boolean): string {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    if (typeof value === "boolean") {
      return value.toString();
    }

    switch (value.kind) {
      case "const":
        return this.formatConstValue(value.value);
      case "temp":
        return value.id;
      case "local":
        return value.name;
      default:
        return "?";
    }
  }

  private formatConstValue(value: bigint | string | boolean): string {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "string") {
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

  private formatBinaryOp(op: string): string {
    const ops: Record<string, string> = {
      add: "add",
      sub: "sub",
      mul: "mul",
      div: "div",
      mod: "mod",
      eq: "eq",
      ne: "ne",
      lt: "lt",
      le: "le",
      gt: "gt",
      ge: "ge",
      and: "and",
      or: "or",
    };
    return ops[op] || op;
  }

  private formatUnaryOp(op: string): string {
    const ops: Record<string, string> = {
      not: "not",
      neg: "neg",
    };
    return ops[op] || op;
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
