import type {
  IrModule,
  IrFunction,
  BasicBlock,
  IrInstruction,
  Value,
  Terminator,
  TypeRef,
} from "@ethdebug/bugc";

export class IrFormatter {
  format(module: IrModule): string {
    const lines: string[] = [];

    // Module header
    lines.push(`// BUG-IR Module: ${module.name}`);
    lines.push("");

    // Storage layout
    if (module.storage.slots && module.storage.slots.length > 0) {
      lines.push("// Storage Layout:");
      module.storage.slots.forEach((field) => {
        lines.push(
          `//   [${field.slot}] ${field.name}: ${this.formatType(field.type)}`,
        );
      });
      lines.push("");
    }

    // User-defined functions
    for (const [name, func] of module.functions) {
      lines.push(this.formatFunction(name, func));
      lines.push("");
    }

    // Constructor function
    if (module.create) {
      lines.push(this.formatFunction("create", module.create));
      lines.push("");
    }

    // Main function
    lines.push(this.formatFunction("main", module.main));

    return lines.join("\n");
  }

  private formatFunction(name: string, func: IrFunction): string {
    const lines: string[] = [];

    // Function header
    lines.push(`function ${name}() {`);

    // Format each block
    for (const [blockId, block] of func.blocks) {
      lines.push(this.formatBlock(blockId, block));
    }

    lines.push("}");
    return lines.join("\n");
  }

  private formatBlock(id: string, block: BasicBlock): string {
    const lines: string[] = [];

    // Block label
    lines.push(`  ${id}:  // ${id === "entry" ? "entry point" : ""}`);

    // Phi nodes
    for (const phi of block.phis) {
      const sources: string[] = [];
      for (const [pred, value] of phi.sources) {
        sources.push(`${pred}: ${this.formatValue(value)}`);
      }
      lines.push(`    ${phi.dest} = phi [${sources.join(", ")}]`);
    }

    // Instructions
    for (const inst of block.instructions) {
      lines.push(`    ${this.formatInstruction(inst)}`);
    }

    // Terminator
    lines.push(`    ${this.formatTerminator(block.terminator)}`);

    return lines.join("\n");
  }

  private formatInstruction(inst: IrInstruction): string {
    switch (inst.kind) {
      case "const":
        return `${inst.dest} = ${inst.value}`;

      case "binary":
        return `${inst.dest} = ${inst.op} ${this.formatValue(inst.left)}, ${this.formatValue(inst.right)}`;

      case "unary":
        return `${inst.dest} = ${inst.op} ${this.formatValue(inst.operand)}`;

      case "load_storage":
        return `${inst.dest} = load storage[${this.formatValue(inst.slot)}]`;

      case "store_storage":
        return `store storage[${this.formatValue(inst.slot)}] = ${this.formatValue(inst.value)}`;

      case "env":
        return `${inst.dest} = ${inst.op}`;

      case "compute_slot":
        return `${inst.dest} = compute_slot ${this.formatValue(inst.baseSlot)}, ${this.formatValue(inst.key)}`;

      case "compute_array_slot":
        return `${inst.dest} = compute_array_slot ${this.formatValue(inst.baseSlot)}`;

      case "call": {
        const args = inst.arguments
          .map((a: Value) => this.formatValue(a))
          .join(", ");
        return inst.dest
          ? `${inst.dest} = call ${inst.function}(${args})`
          : `call ${inst.function}(${args})`;
      }

      default: {
        const anyInst = inst as IrInstruction & { dest?: string };
        return `${anyInst.dest || ""} = ${inst.kind} [unknown format]`;
      }
    }
  }

  private formatTerminator(term: Terminator): string {
    switch (term.kind) {
      case "return":
        return term.value
          ? `return ${this.formatValue(term.value)}`
          : "return void";

      case "jump":
        return `jump ${term.target}`;

      case "branch":
        return `branch ${this.formatValue(term.condition)} ? ${term.trueTarget} : ${term.falseTarget}`;

      default: {
        const unknownTerm = term as Terminator & { kind: string };
        return `${unknownTerm.kind} [unknown format]`;
      }
    }
  }

  private formatValue(value: Value): string {
    if (value.kind === "const") {
      return value.value.toString();
    } else if (value.kind === "temp") {
      return value.id;
    } else {
      return value.name;
    }
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
        return `mapping<${this.formatType(type.key)}, ${this.formatType(type.value)}>`;
      case "struct":
        return type.name;
      default:
        return "unknown";
    }
  }
}
