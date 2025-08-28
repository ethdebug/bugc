/**
 * IR Validator - checks IR consistency and correctness
 */

import {
  IrModule,
  IrFunction,
  BasicBlock,
  IrInstruction,
  Value,
  TypeRef,
} from "../ir";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class IrValidator {
  private errors: string[] = [];
  private warnings: string[] = [];
  private tempDefs: Set<string> = new Set();
  private tempUses: Set<string> = new Set();
  private localDefs: Set<string> = new Set();
  private blockIds: Set<string> = new Set();

  validate(module: IrModule): ValidationResult {
    this.errors = [];
    this.warnings = [];
    this.tempDefs = new Set();
    this.tempUses = new Set();
    this.localDefs = new Set();
    this.blockIds = new Set();

    // Validate module structure
    this.validateModule(module);

    // Check for undefined temporaries
    this.checkUndefinedTemporaries();

    return {
      isValid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  private validateModule(module: IrModule): void {
    // Check module has a name
    if (!module.name) {
      this.error("Module must have a name");
    }

    // Validate storage layout
    this.validateStorageLayout(module.storage);

    // Validate main function
    if (!module.main) {
      this.error("Module must have a main function");
    } else {
      this.validateFunction(module.main);
    }
  }

  private validateStorageLayout(storage: IrModule["storage"]): void {
    const usedSlots = new Set<number>();

    for (const slot of storage.slots) {
      // Check for duplicate slot numbers
      if (usedSlots.has(slot.slot)) {
        this.error(`Duplicate storage slot ${slot.slot}`);
      }
      usedSlots.add(slot.slot);

      // Check slot number is non-negative
      if (slot.slot < 0) {
        this.error(`Storage slot ${slot.slot} must be non-negative`);
      }

      // Validate type
      this.validateType(slot.type);
    }
  }

  private validateFunction(func: IrFunction): void {
    // Collect all block IDs
    for (const blockId of func.blocks.keys()) {
      this.blockIds.add(blockId);
    }

    // Check entry block exists
    if (!func.blocks.has(func.entry)) {
      this.error(`Entry block '${func.entry}' not found in function`);
    }

    // Validate locals
    for (const local of func.locals) {
      if (!local.id || !local.name) {
        this.error("Local variable must have id and name");
      }
      this.localDefs.add(local.id);
      this.validateType(local.type);
    }

    // Validate each block
    for (const [blockId, block] of func.blocks.entries()) {
      this.validateBlock(blockId, block, func);
    }

    // Check for unreachable blocks
    this.checkUnreachableBlocks(func);

    // Check predecessor consistency
    this.checkPredecessorConsistency(func);
  }

  private validateBlock(
    blockId: string,
    block: BasicBlock,
    _func: IrFunction,
  ): void {
    // Validate instructions
    for (const inst of block.instructions) {
      this.validateInstruction(inst);
    }

    // Validate terminator
    this.validateTerminator(block.terminator);

    // Check terminator targets exist
    const targets = this.getTerminatorTargets(block.terminator);
    for (const target of targets) {
      if (!this.blockIds.has(target)) {
        this.error(
          `Block '${blockId}' jumps to non-existent block '${target}'`,
        );
      }
    }
  }

  private validateInstruction(inst: IrInstruction): void {
    // Check instruction has required fields
    if (!inst.kind) {
      this.error("Instruction must have a kind");
      return;
    }

    // Validate based on instruction type
    switch (inst.kind) {
      case "const":
        this.validateConstInstruction(inst);
        break;
      case "load_storage":
        this.validateLoadStorageInstruction(inst);
        break;
      case "store_storage":
        this.validateStoreStorageInstruction(inst);
        break;
      case "load_local":
        this.validateLoadLocalInstruction(inst);
        break;
      case "store_local":
        this.validateStoreLocalInstruction(inst);
        break;
      case "binary":
        this.validateBinaryInstruction(inst);
        break;
      case "unary":
        this.validateUnaryInstruction(inst);
        break;
      case "env":
        this.validateEnvInstruction(inst);
        break;
      case "load_mapping":
        this.validateLoadMappingInstruction(inst);
        break;
      case "store_mapping":
        this.validateStoreMappingInstruction(inst);
        break;
      case "compute_slot":
        this.validateComputeSlotInstruction(inst);
        break;
      case "compute_array_slot":
        this.validateComputeArraySlotInstruction(inst);
        break;
      case "compute_field_offset":
        this.validateComputeFieldOffsetInstruction(inst);
        break;
      case "load_field":
        this.validateLoadFieldInstruction(inst);
        break;
      case "store_field":
        this.validateStoreFieldInstruction(inst);
        break;
      case "load_index":
        this.validateLoadIndexInstruction(inst);
        break;
      case "store_index":
        this.validateStoreIndexInstruction(inst);
        break;
      case "hash":
        this.validateHashInstruction(inst);
        break;
      // Add more instruction validations as needed
    }
  }

  private validateConstInstruction(inst: IrInstruction): void {
    if (inst.kind !== "const") return;

    if (!inst.dest) {
      this.error("Const instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (inst.value === undefined) {
      this.error("Const instruction must have a value");
    }

    this.validateType(inst.type);
  }

  private validateLoadStorageInstruction(inst: IrInstruction): void {
    if (inst.kind !== "load_storage") return;

    if (!inst.dest) {
      this.error("Load storage instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.slot) {
      this.error("Load storage instruction must have a slot");
    } else {
      this.validateValue(inst.slot);
    }

    this.validateType(inst.type);
  }

  private validateStoreStorageInstruction(inst: IrInstruction): void {
    if (inst.kind !== "store_storage") return;

    if (!inst.slot) {
      this.error("Store storage instruction must have a slot");
    } else {
      this.validateValue(inst.slot);
    }

    if (!inst.value) {
      this.error("Store storage instruction must have a value");
    } else {
      this.validateValue(inst.value);
    }
  }

  private validateLoadLocalInstruction(inst: IrInstruction): void {
    if (inst.kind !== "load_local") return;

    if (!inst.dest) {
      this.error("Load local instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.local) {
      this.error("Load local instruction must specify a local");
    } else if (!this.localDefs.has(inst.local)) {
      this.error(`Load local references undefined local '${inst.local}'`);
    }
  }

  private validateStoreLocalInstruction(inst: IrInstruction): void {
    if (inst.kind !== "store_local") return;

    if (!inst.local) {
      this.error("Store local instruction must specify a local");
    } else if (!this.localDefs.has(inst.local)) {
      this.error(`Store local references undefined local '${inst.local}'`);
    }

    if (!inst.value) {
      this.error("Store local instruction must have a value");
    } else {
      this.validateValue(inst.value);
    }
  }

  private validateBinaryInstruction(inst: IrInstruction): void {
    if (inst.kind !== "binary") return;

    if (!inst.dest) {
      this.error("Binary instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.op) {
      this.error("Binary instruction must have an operator");
    }

    if (!inst.left) {
      this.error("Binary instruction must have a left operand");
    } else {
      this.validateValue(inst.left);
    }

    if (!inst.right) {
      this.error("Binary instruction must have a right operand");
    } else {
      this.validateValue(inst.right);
    }
  }

  private validateUnaryInstruction(inst: IrInstruction): void {
    if (inst.kind !== "unary") return;

    if (!inst.dest) {
      this.error("Unary instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.op) {
      this.error("Unary instruction must have an operator");
    }

    if (!inst.operand) {
      this.error("Unary instruction must have an operand");
    } else {
      this.validateValue(inst.operand);
    }
  }

  private validateEnvInstruction(inst: IrInstruction): void {
    if (inst.kind !== "env") return;

    if (!inst.dest) {
      this.error("Env instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.op) {
      this.error("Env instruction must have an operation");
    }

    const validOps = [
      "msg_sender",
      "msg_value",
      "block_number",
      "block_timestamp",
    ];
    if (!validOps.includes(inst.op)) {
      this.error(`Invalid env operation '${inst.op}'`);
    }
  }

  private validateLoadMappingInstruction(inst: IrInstruction): void {
    if (inst.kind !== "load_mapping") return;

    if (!inst.dest) {
      this.error("Load mapping instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (inst.slot === undefined) {
      this.error("Load mapping instruction must have a slot");
    }

    if (!inst.key) {
      this.error("Load mapping instruction must have a key");
    } else {
      this.validateValue(inst.key);
    }

    this.validateType(inst.valueType);
  }

  private validateStoreMappingInstruction(inst: IrInstruction): void {
    if (inst.kind !== "store_mapping") return;

    if (inst.slot === undefined) {
      this.error("Store mapping instruction must have a slot");
    }

    if (!inst.key) {
      this.error("Store mapping instruction must have a key");
    } else {
      this.validateValue(inst.key);
    }

    if (!inst.value) {
      this.error("Store mapping instruction must have a value");
    } else {
      this.validateValue(inst.value);
    }
  }

  private validateComputeSlotInstruction(inst: IrInstruction): void {
    if (inst.kind !== "compute_slot") return;

    if (!inst.dest) {
      this.error("Compute slot instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.baseSlot) {
      this.error("Compute slot instruction must have a base slot");
    } else {
      this.validateValue(inst.baseSlot);
    }

    if (!inst.key) {
      this.error("Compute slot instruction must have a key");
    } else {
      this.validateValue(inst.key);
    }

    this.validateType(inst.keyType);
  }

  private validateComputeArraySlotInstruction(inst: IrInstruction): void {
    if (inst.kind !== "compute_array_slot") return;

    if (!inst.dest) {
      this.error("Compute array slot instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.baseSlot) {
      this.error("Compute array slot instruction must have a base slot");
    } else {
      this.validateValue(inst.baseSlot);
    }
  }

  private validateComputeFieldOffsetInstruction(inst: IrInstruction): void {
    if (inst.kind !== "compute_field_offset") return;

    if (!inst.dest) {
      this.error("Compute field offset instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.baseSlot) {
      this.error("Compute field offset instruction must have a base slot");
    } else {
      this.validateValue(inst.baseSlot);
    }

    if (inst.fieldIndex === undefined) {
      this.error("Compute field offset instruction must have a field index");
    }
  }

  private validateLoadFieldInstruction(inst: IrInstruction): void {
    if (inst.kind !== "load_field") return;

    if (!inst.dest) {
      this.error("Load field instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.object) {
      this.error("Load field instruction must have an object");
    } else {
      this.validateValue(inst.object);
    }

    if (!inst.field) {
      this.error("Load field instruction must have a field name");
    }

    if (inst.fieldIndex === undefined) {
      this.error("Load field instruction must have a field index");
    }

    this.validateType(inst.type);
  }

  private validateStoreFieldInstruction(inst: IrInstruction): void {
    if (inst.kind !== "store_field") return;

    if (!inst.object) {
      this.error("Store field instruction must have an object");
    } else {
      this.validateValue(inst.object);
    }

    if (!inst.field) {
      this.error("Store field instruction must have a field name");
    }

    if (inst.fieldIndex === undefined) {
      this.error("Store field instruction must have a field index");
    }

    if (!inst.value) {
      this.error("Store field instruction must have a value");
    } else {
      this.validateValue(inst.value);
    }
  }

  private validateLoadIndexInstruction(inst: IrInstruction): void {
    if (inst.kind !== "load_index") return;

    if (!inst.dest) {
      this.error("Load index instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.array) {
      this.error("Load index instruction must have an array");
    } else {
      this.validateValue(inst.array);
    }

    if (!inst.index) {
      this.error("Load index instruction must have an index");
    } else {
      this.validateValue(inst.index);
    }

    this.validateType(inst.elementType);
  }

  private validateStoreIndexInstruction(inst: IrInstruction): void {
    if (inst.kind !== "store_index") return;

    if (!inst.array) {
      this.error("Store index instruction must have an array");
    } else {
      this.validateValue(inst.array);
    }

    if (!inst.index) {
      this.error("Store index instruction must have an index");
    } else {
      this.validateValue(inst.index);
    }

    if (!inst.value) {
      this.error("Store index instruction must have a value");
    } else {
      this.validateValue(inst.value);
    }
  }

  private validateHashInstruction(inst: IrInstruction): void {
    if (inst.kind !== "hash") return;

    if (!inst.dest) {
      this.error("Hash instruction must have a destination");
    } else {
      this.tempDefs.add(inst.dest);
    }

    if (!inst.value) {
      this.error("Hash instruction must have a value");
    } else {
      this.validateValue(inst.value);
    }
  }

  private validateTerminator(term: BasicBlock["terminator"]): void {
    if (!term.kind) {
      this.error("Terminator must have a kind");
      return;
    }

    switch (term.kind) {
      case "jump":
        if (!term.target) {
          this.error("Jump terminator must have a target");
        }
        break;

      case "branch":
        if (!term.condition) {
          this.error("Branch terminator must have a condition");
        } else {
          this.validateValue(term.condition);
        }
        if (!term.trueTarget) {
          this.error("Branch terminator must have a true target");
        }
        if (!term.falseTarget) {
          this.error("Branch terminator must have a false target");
        }
        break;

      case "return":
        if (term.value) {
          this.validateValue(term.value);
        }
        break;

      default:
        this.error(
          `Unknown terminator kind '${(term as unknown as { kind: string }).kind}'`,
        );
    }
  }

  private validateValue(value: Value): void {
    if (!value || typeof value !== "object") return;

    switch (value.kind) {
      case "temp":
        if (!value.id) {
          this.error("Temp value must have an id");
        } else {
          this.tempUses.add(value.id);
        }
        break;

      case "local":
        if (!value.name) {
          this.error("Local value must have a name");
        } else if (!this.localDefs.has(`local_${value.name}`)) {
          // Note: local names in values don't have the local_ prefix
          // but we need to check against the defined locals
        }
        break;

      case "const":
        if (value.value === undefined) {
          this.error("Const value must have a value");
        }
        break;

      default:
        this.error(
          `Unknown value kind '${(value as unknown as { kind: string }).kind}'`,
        );
    }

    if (value.type) {
      this.validateType(value.type);
    }
  }

  private validateType(type: TypeRef): void {
    if (!type || !type.kind) {
      this.error("Type must have a kind");
      return;
    }

    switch (type.kind) {
      case "uint":
        if (!type.bits || ![8, 16, 32, 64, 128, 256].includes(type.bits)) {
          this.error(`Invalid uint bit size: ${type.bits}`);
        }
        break;

      case "bytes":
        if (type.size !== undefined && (type.size < 1 || type.size > 32)) {
          this.error(`Invalid bytes size: ${type.size}`);
        }
        break;

      case "array":
        if (!type.element) {
          this.error("Array type must have an element type");
        } else {
          this.validateType(type.element);
        }
        if (type.size !== undefined && type.size < 0) {
          this.error(`Array size must be non-negative: ${type.size}`);
        }
        break;

      case "mapping":
        if (!type.key) {
          this.error("Mapping type must have a key type");
        } else {
          this.validateType(type.key);
        }
        if (!type.value) {
          this.error("Mapping type must have a value type");
        } else {
          this.validateType(type.value);
        }
        break;

      case "struct":
        if (!type.name) {
          this.error("Struct type must have a name");
        }
        break;

      case "address":
      case "bool":
      case "string":
        // These types have no additional validation
        break;

      default:
        this.error(
          `Unknown type kind '${(type as unknown as { kind: string }).kind}'`,
        );
    }
  }

  private checkUndefinedTemporaries(): void {
    for (const tempId of this.tempUses) {
      if (!this.tempDefs.has(tempId)) {
        this.error(`Use of undefined temporary '${tempId}'`);
      }
    }
  }

  private checkUnreachableBlocks(func: IrFunction): void {
    const reachable = new Set<string>();
    const worklist = [func.entry];

    while (worklist.length > 0) {
      const blockId = worklist.pop()!;
      if (reachable.has(blockId)) continue;

      reachable.add(blockId);
      const block = func.blocks.get(blockId);
      if (!block) continue;

      const targets = this.getTerminatorTargets(block.terminator);
      worklist.push(...targets);
    }

    for (const blockId of func.blocks.keys()) {
      if (!reachable.has(blockId)) {
        this.warning(`Block '${blockId}' is unreachable`);
      }
    }
  }

  private checkPredecessorConsistency(func: IrFunction): void {
    // Build actual predecessor sets
    const actualPreds = new Map<string, Set<string>>();

    for (const [blockId, block] of func.blocks.entries()) {
      const targets = this.getTerminatorTargets(block.terminator);
      for (const target of targets) {
        if (!actualPreds.has(target)) {
          actualPreds.set(target, new Set());
        }
        actualPreds.get(target)!.add(blockId);
      }
    }

    // Check consistency
    for (const [blockId, block] of func.blocks.entries()) {
      const expected = actualPreds.get(blockId) || new Set();
      const recorded = block.predecessors;

      // Check for missing predecessors
      for (const pred of expected) {
        if (!recorded.has(pred)) {
          this.error(`Block '${blockId}' missing predecessor '${pred}'`);
        }
      }

      // Check for extra predecessors
      for (const pred of recorded) {
        if (!expected.has(pred)) {
          this.error(`Block '${blockId}' has invalid predecessor '${pred}'`);
        }
      }
    }
  }

  private getTerminatorTargets(term: BasicBlock["terminator"]): string[] {
    switch (term.kind) {
      case "jump":
        return [term.target];
      case "branch":
        return [term.trueTarget, term.falseTarget];
      case "return":
        return [];
      default:
        return [];
    }
  }

  private error(message: string): void {
    this.errors.push(message);
  }

  private warning(message: string): void {
    this.warnings.push(message);
  }
}
