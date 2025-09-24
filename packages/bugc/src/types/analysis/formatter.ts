import type * as Ast from "#ast";
import { Type, type Types } from "#types/spec";

export class Formatter {
  private output: string[] = [];
  private indent = 0;
  private source?: string;

  format(types: Types, source?: string): string {
    this.output = [];
    this.indent = 0;
    this.source = source;

    this.line("=== Type Information ===");
    this.line("");

    // Group types by their AST node kind
    const groupedTypes = this.groupByNodeKind(types);

    // Format each group
    for (const [kind, entries] of groupedTypes) {
      this.formatGroup(kind, entries);
    }

    return this.output.join("\n");
  }

  private groupByNodeKind(types: Types): Map<string, Array<[Ast.Id, Type]>> {
    const groups = new Map<string, Array<[Ast.Id, Type]>>();

    for (const [id, type] of types) {
      const kind = this.getNodeKind(id);
      if (!groups.has(kind)) {
        groups.set(kind, []);
      }
      groups.get(kind)!.push([id, type]);
    }

    // Sort groups for consistent output
    return new Map(
      [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  private getNodeKind(_id: Ast.Id): string {
    // Extract the node kind from the ID
    // IDs are numeric with underscore separator like "31_1"
    // For now, group all as "TypedExpressions"
    return "TypedExpressions";
  }

  private formatGroup(kind: string, entries: Array<[Ast.Id, Type]>) {
    this.line(`${kind}:`);
    this.indent++;

    // Sort entries by their position in the source
    const sortedEntries = [...entries].sort(([a], [b]) => {
      const posA = this.extractPosition(a);
      const posB = this.extractPosition(b);
      if (posA.line !== posB.line) {
        return posA.line - posB.line;
      }
      return posA.col - posB.col;
    });

    for (const [id, type] of sortedEntries) {
      this.formatEntry(id, type);
    }

    this.indent--;
    this.line("");
  }

  private extractPosition(id: Ast.Id): { line: number; col: number } {
    // IDs are in format like "31_1" (byteOffset_length)
    const parts = id.split("_");
    const byteOffset = parseInt(parts[0] || "0", 10);

    // Convert byte offset to line/column if we have source
    if (this.source) {
      const { line, col } = this.offsetToLineCol(this.source, byteOffset);
      return { line, col };
    }

    // Fallback: just use byte offset as line for sorting
    return { line: byteOffset, col: 0 };
  }

  private offsetToLineCol(
    source: string,
    offset: number,
  ): { line: number; col: number } {
    let line = 1;
    let col = 1;

    for (let i = 0; i < Math.min(offset, source.length); i++) {
      if (source[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
    }

    return { line, col };
  }

  private formatEntry(id: Ast.Id, type: Type) {
    // IDs are in format like "offset_length"
    const parts = id.split("_");
    const offset = parseInt(parts[0] || "0", 10);
    const length = parseInt(parts[1] || "0", 10);

    let position: string;
    if (this.source) {
      const start = this.offsetToLineCol(this.source, offset);
      const end = this.offsetToLineCol(this.source, offset + length);

      if (start.line === end.line) {
        // Same line: show as line:col1-col2
        position = `${start.line}:${start.col}-${end.col}`;
      } else {
        // Multiple lines: show full range
        position = `${start.line}:${start.col}-${end.line}:${end.col}`;
      }
    } else {
      position = `offset ${offset}, length ${length}`;
    }

    // Format the type using the built-in formatter
    const typeStr = Type.format(type);

    // Build the entry line
    const entry = `${position}: ${typeStr}`;

    // Add additional details for complex types
    if (Type.isStruct(type)) {
      this.line(entry);
      this.indent++;
      this.formatStructDetails(type);
      this.indent--;
    } else if (Type.isFunction(type)) {
      this.line(entry);
      this.indent++;
      this.formatFunctionDetails(type);
      this.indent--;
    } else if (Type.isArray(type)) {
      this.line(entry);
      this.indent++;
      this.formatArrayDetails(type);
      this.indent--;
    } else if (Type.isMapping(type)) {
      this.line(entry);
      this.indent++;
      this.formatMappingDetails(type);
      this.indent--;
    } else {
      this.line(entry);
    }
  }

  private formatStructDetails(struct: Type.Struct) {
    this.line("fields:");
    this.indent++;
    for (const [fieldName, fieldType] of struct.fields) {
      const layout = struct.layout.get(fieldName);
      const layoutStr = layout
        ? ` [offset: ${layout.byteOffset}, size: ${layout.size}]`
        : "";
      this.line(`${fieldName}: ${Type.format(fieldType)}${layoutStr}`);
    }
    this.indent--;
  }

  private formatFunctionDetails(func: Type.Function) {
    if (func.parameters.length > 0) {
      this.line("parameters:");
      this.indent++;
      func.parameters.forEach((param, index) => {
        this.line(`[${index}]: ${Type.format(param)}`);
      });
      this.indent--;
    }

    if (func.return !== null) {
      this.line(`returns: ${Type.format(func.return)}`);
    } else {
      this.line("returns: void");
    }
  }

  private formatArrayDetails(array: Type.Array) {
    this.line(`element type: ${Type.format(array.element)}`);
    if (array.size !== undefined) {
      this.line(`size: ${array.size}`);
    } else {
      this.line("size: dynamic");
    }
  }

  private formatMappingDetails(mapping: Type.Mapping) {
    this.line(`key type: ${Type.format(mapping.key)}`);
    this.line(`value type: ${Type.format(mapping.value)}`);
  }

  private line(text: string) {
    const indentStr = "  ".repeat(this.indent);
    this.output.push(indentStr + text);
  }
}
