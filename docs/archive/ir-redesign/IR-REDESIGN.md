# BUG IR Redesign: Unified Read/Write Instructions

## Overview

This document outlines a redesign of the BUG intermediate representation (IR) to create cleaner, more consistent memory/storage access semantics. The current IR has a confusing mix of instruction types (`load_storage`, `store_storage`, `load_field`, `store_field`, `load_index`, `store_index`, etc.) that doesn't cleanly separate concerns between different memory locations and access patterns.

## Design Principles

1. **Unified read/write instructions** with explicit location parameter
2. **Clear separation** between locations (storage, memory, calldata, etc.)
3. **Alignment with ethdebug format** for debugging compatibility
4. **Closed types** with location-specific required fields (no polymorphic interfaces)
5. **Separate computation from access** (compute instructions for address calculation)

## Memory Locations

Following the ethdebug format structure, we recognize these distinct locations:

- **storage** - Persistent contract storage (segment-based: slot/offset/length)
- **transient** - Transient storage (segment-based: slot/offset/length)
- **memory** - EVM memory (slice-based: offset/length)
- **calldata** - Input data (slice-based: offset/length, read-only)
- **returndata** - Return data from calls (slice-based: offset/length, read-only)
- **code** - Contract code (slice-based: offset/length, read-only)
- **local** - IR-level local variables (name-based)

Note: **stack** is excluded as it's an EVM implementation detail, not an IR concern.

## Addressing Schemes

Per ethdebug format:

- **Segment-based** (storage, transient): Addressed by slot + offset within slot + length
- **Slice-based** (memory, calldata, returndata, code): Addressed by byte offset + length
- **Name-based** (local): Addressed by variable name

## Proposed IR Instructions

### Read/Write Instructions

```
// Compact syntax with * for word-sized (32-byte) defaults
%<temp> = storage[<slot>*]              // Read 32 bytes from storage slot at offset 0
%<temp> = memory[<offset>*]             // Read 32 bytes from memory
storage[<slot>*] = <value>              // Write 32 bytes to storage slot at offset 0
memory[<offset>*] = <value>             // Write 32 bytes to memory

// Full syntax with named parameters for non-defaults
%<temp> = storage[slot: <slot>, offset: <offset>, length: <length>]
%<temp> = memory[offset: <offset>, length: <length>]
storage[slot: <slot>, offset: <offset>, length: <length>] = <value>
memory[offset: <offset>, length: <length>] = <value>
```

Location-specific patterns:

- **storage/transient**: Require `slot`, optional `offset` and `length` (defaults: 0, 32)
- **memory/calldata/returndata/code**: Require `offset`, optional `length` (default: 32)
- **local**: Use `name` parameter

### Compute Instructions

```
// Compute slot - dot notation for clarity
%<temp> = slot[<base>].mapping[<key>]           // Mapping access
%<temp> = slot[<base>].array[<index>]           // Array access
%<temp> = slot[<base>].field[<offset>]          // Field access (by byte offset)

// Compute offset - dot notation with defaults
%<temp> = offset[<base>].array[<index>]         // Array with default stride=32
%<temp> = offset[<base>].array[index: <index>, stride: <stride>]  // Custom stride
%<temp> = offset[<base>].field[<offset>]        // Field by byte offset
%<temp> = offset[<base>].byte[<offset>]         // Raw byte offset

// Slice operation
%<temp> = slice object=<value>, start=<value>, end=<value>
```

## Examples by Category

### Simple Storage Operations

#### Example 1: Basic Storage Variable

```bug
storage {
  [0] balance: uint256;
}
code {
  balance = 100;
  let x = balance;
}
```

**IR:**

```
storage[0*] = 100
%x = storage[0*]
```

**EVM Strategy:** Direct SSTORE/SLOAD to slot 0

---

#### Example 2: Storage Struct Fields (Packed)

```bug
storage {
  [1] user: struct {
    name: bytes32;      // slot 1, offset 0-31
    balance: uint128;   // slot 2, offset 0-15
    active: bool;       // slot 2, offset 16
  }
}
code {
  user.balance = 1000;
  user.active = true;
}
```

**IR:**

```
// For packed structs, offsets are known at compile time
storage[slot: 2, offset: 0, length: 16] = 1000  // balance
storage[slot: 2, offset: 16, length: 1] = true   // active
```

**EVM Strategy:** SSTORE with bit shifting/masking for packed fields within slots

### Mapping Operations

#### Example 3: Simple Mapping

```bug
storage {
  [5] balances: mapping(address => uint256);
}
code {
  balances[msg.sender] = 500;
  let bal = balances[msg.sender];
}
```

**IR:**

```
%sender = env msg_sender
%slot = slot[5].mapping[%sender]
storage[%slot*] = 500
%bal = storage[%slot*]
```

**EVM Strategy:** Keccak256(sender || 5) then SSTORE/SLOAD

---

#### Example 4: Nested Mappings

```bug
storage {
  [10] approvals: mapping(address => mapping(address => uint256));
}
code {
  approvals[owner][spender] = amount;
}
```

**IR:**

```
%slot1 = slot[10].mapping[%owner]
%slot2 = slot[%slot1].mapping[%spender]
storage[%slot2*] = %amount
```

**EVM Strategy:** Double keccak256 hashing for nested mappings

### Array Operations

#### Example 5: Storage Array Access

```bug
storage {
  [7] items: uint256[];
}
code {
  items[i] = value;
  let item = items[i];
}
```

**IR:**

```
%base_slot = slot[7].array[%i]
storage[%base_slot*] = %value
%item = storage[%base_slot*]
```

**EVM Strategy:** Keccak256(7) + i, then SSTORE/SLOAD

---

#### Example 6: Memory Array Access

```bug
code {
  let arr: uint256[10] = ...;
  arr[3] = 42;
  let val = arr[3];
}
```

**IR:**

```
%offset = offset[%arr].array[3]
memory[%offset*] = 42
%val = memory[%offset*]
```

**EVM Strategy:** Calculate arr + 3\*32, then MSTORE/MLOAD

---

#### Example 7: Nested Arrays

```bug
storage {
  [15] matrix: uint256[][];
}
code {
  matrix[i][j] = value;
  let elem = matrix[i][j];
}
```

**IR:**

```
// First dimension: matrix[i]
%inner_array_slot = slot[15].array[%i]

// Second dimension: matrix[i][j]
%element_slot = slot[%inner_array_slot].array[%j]

storage[%element_slot*] = %value
%elem = storage[%element_slot*]
```

**EVM Strategy:** Double keccak256 for nested dynamic arrays

### Struct Operations

#### Example 8: Memory Struct Field

```bug
code {
  let user: struct { id: uint256; data: bytes32 } = ...;
  let id = user.id;
  user.data = 0xabc...;
}
```

**IR:**

```
%id_offset = offset[%user].field[0]
%id = memory[%id_offset*]

%data_offset = offset[%user].field[32]
memory[%data_offset*] = 0xabc...
```

**EVM Strategy:** Direct MLOAD/MSTORE at struct base + field offset

---

#### Example 9: Nested Structs in Storage

```bug
storage {
  [2] company: struct {
    name: bytes32;        // slot 2
    ceo: struct {
      addr: address;      // slot 3, offset 0-19
      salary: uint256;    // slot 4
    };
    founded: uint64;      // slot 5
  }
}
code {
  company.ceo.salary = 1000000;
  let ceo_addr = company.ceo.addr;
}
```

**IR:**

```
// CEO salary is at slot 4 (base slot 2 + struct layout)
storage[4*] = 1000000

// CEO address is at slot 3, first 20 bytes
%ceo_addr = storage[slot: 3, offset: 0, length: 20]
```

**EVM Strategy:** Calculate nested struct slot offsets based on layout

### Function Calls (Block Terminators)

#### Example 10: Internal Function Calls

**Note:** As of the recent IR redesign, function calls are now block terminators, not regular instructions. This ensures explicit control flow and proper SSA form.

```bug
define {
  function add(a: uint256, b: uint256) -> uint256 {
    return a + b;
  };

  function addThree(x: uint256, y: uint256, z: uint256) -> uint256 {
    let sum1 = add(x, y);
    let sum2 = add(sum1, z);
    return sum2;
  };
}

code {
  let result = addThree(10, 20, 30);
}
```

**IR:**

```
// Main function
function main() {
  entry:
    %t0 = const 10
    %t1 = const 20
    %t2 = const 30
    %result = call addThree(%t0, %t1, %t2) -> call_cont_1

  call_cont_1:
    // ... continue after call
    return void
}

// Function addThree
function addThree(^x: uint256, ^y: uint256, ^z: uint256) -> uint256 {
  entry:
    %sum1 = call add(^x, ^y) -> call_cont_1

  call_cont_1:
    %sum2 = call add(%sum1, ^z) -> call_cont_2

  call_cont_2:
    return %sum2
}

// Function add
function add(^a: uint256, ^b: uint256) -> uint256 {
  entry:
    %result = add ^a, ^b
    return %result
}
```

**EVM Strategy:**

- Internal functions become labeled sections in bytecode
- Parameters passed via stack manipulation
- JUMP to function label, JUMP back after return
- Could be inlined by optimizer for small functions

### Slice Operations

#### Example 11: Memory Slice

```bug
code {
  let data: bytes = ...;
  let slice = data[10:50];  // 40 bytes from offset 10
}
```

**IR:**

```
%slice_offset = offset[%data].byte[10]
%slice = slice object=%data, start=10, end=50
```

**EVM Strategy:** Calculate memory offsets, copy to new location with proper length prefix

---

#### Example 12: Storage Bytes Slice (Complex)

```bug
storage {
  [20] data: bytes;  // Dynamic bytes in storage
}
code {
  let slice = data[100:200];  // Extract 100 bytes
}
```

**IR:**

```
// Storage bytes: length at slot 20, data starts at keccak256(20)
%length = storage[20*]

// Calculate starting position
%data_base = slot[20].array[0]
%start_slot = div 100, 32
%start_slot_abs = add %data_base, %start_slot
%start_offset = mod 100, 32

// Allocate memory for result
%slice = alloc_memory length=100

// Read loop (simplified - would need proper loop construct)
%slot0 = read location="storage", slot=%start_slot_abs, offset=%start_offset, length=32
write location="memory", offset=%slice, length=32, value=%slot0
// ... continue reading slots and writing to memory
```

**EVM Strategy:** Complex multi-slot reading with offset calculation, reassemble in memory

### Cross-Location Operations

#### Example 13: Memory to Storage Copy

```bug
storage {
  [30] stored_user: struct { id: uint256; name: bytes32; }
}
code {
  let mem_user: struct { id: uint256; name: bytes32 } = ...;
  stored_user = mem_user;  // Copy entire struct
}
```

**IR:**

```
// Read from memory
%id = memory[%mem_user*]
%name_offset = add %mem_user, 32
%name = memory[%name_offset*]

// Write to storage (consecutive slots)
storage[30*] = %id
storage[31*] = %name
```

**EVM Strategy:** MLOAD fields from memory, SSTORE to consecutive slots

### Special Locations

#### Example 14: Calldata Access

```bug
code {
  let param1 = msg.data[4:36];   // First parameter
  let param2 = msg.data[36:68];  // Second parameter
}
```

**IR:**

```
%param1 = calldata[4*]
%param2 = calldata[36*]
```

**EVM Strategy:** CALLDATALOAD at respective offsets

---

#### Example 15: Transient Storage

```bug
code {
  transient[5] = temp_value;  // Store temporarily
  let val = transient[5];      // Read back
}
```

**IR:**

```
transient[5*] = %temp_value
%val = transient[5*]
```

**EVM Strategy:** TSTORE/TLOAD opcodes (available since Cancun)

---

#### Example 16: Return Data Access

```bug
code {
  let (success, data) = other_contract.call(...);
  let return_val = returndata[0:32];
}
```

**IR:**

```
%result = call external(%other_contract, ...) -> call_cont
// In continuation block:
%return_val = returndata[0*]
```

**EVM Strategy:** After CALL, use RETURNDATASIZE and RETURNDATACOPY

## Key Insights

1. **Storage slicing is complex** - Requires multi-slot reads and reassembly in memory due to how dynamic bytes are stored
2. **Nested structures** need recursive offset computation, especially when crossing slot boundaries
3. **Mixed locations** (e.g., memory→storage copies) need explicit read/write pairs
4. **Transient storage** follows same pattern as regular storage with segment-based addressing
5. **Dynamic arrays in storage** use keccak hashing at each nesting level for slot calculation
6. **Slice operations** might deserve optimization passes to batch adjacent reads
7. **Offset computation differs** significantly between memory (simple byte offsets) and storage (slot+offset with packing considerations)
8. **Location determines EVM strategy** - The location parameter directly maps to which EVM opcodes will be used
9. **Internal function calls** are block terminators (not regular instructions), ensuring explicit control flow

## TypeScript Type Definitions (Proposed)

```typescript
import type * as Format from "@ethdebug/format";

// Base types for addressing
type SlotAddress = {
  slot: Value;
  offset: Value;
  length: Value;
};

type OffsetAddress = {
  offset: Value;
  length: Value;
};

type NameAddress = {
  name: string;
};

// Read instruction variants (closed types)
type ReadStorage = {
  kind: "read";
  location: "storage";
  slot: Value;
  offset: Value;
  length: Value;
  dest: string;
  type: Type;
};

type ReadTransient = {
  kind: "read";
  location: "transient";
  slot: Value;
  offset: Value;
  length: Value;
  dest: string;
  type: Type;
};

type ReadMemory = {
  kind: "read";
  location: "memory";
  offset: Value;
  length: Value;
  dest: string;
  type: Type;
};

type ReadCalldata = {
  kind: "read";
  location: "calldata";
  offset: Value;
  length: Value;
  dest: string;
  type: Type;
};

type ReadReturndata = {
  kind: "read";
  location: "returndata";
  offset: Value;
  length: Value;
  dest: string;
  type: Type;
};

type ReadCode = {
  kind: "read";
  location: "code";
  offset: Value;
  length: Value;
  dest: string;
  type: Type;
};

type ReadLocal = {
  kind: "read";
  location: "local";
  name: string;
  dest: string;
  type: Type;
};

type Read =
  | ReadStorage
  | ReadTransient
  | ReadMemory
  | ReadCalldata
  | ReadReturndata
  | ReadCode
  | ReadLocal;

// Write instruction variants (no writes to calldata/returndata/code)
type WriteStorage = {
  kind: "write";
  location: "storage";
  slot: Value;
  offset: Value;
  length: Value;
  value: Value;
};

type WriteTransient = {
  kind: "write";
  location: "transient";
  slot: Value;
  offset: Value;
  length: Value;
  value: Value;
};

type WriteMemory = {
  kind: "write";
  location: "memory";
  offset: Value;
  length: Value;
  value: Value;
};

type WriteLocal = {
  kind: "write";
  location: "local";
  name: string;
  value: Value;
};

type Write = WriteStorage | WriteTransient | WriteMemory | WriteLocal;

// Compute instructions with discriminated unions for type safety
type ComputeSlot =
  | {
      kind: "compute_slot";
      slotKind: "mapping";
      base: Value;
      key: Value;
      keyType: Type;
      dest: string;
    }
  | {
      kind: "compute_slot";
      slotKind: "array";
      base: Value;
      index: Value;
      dest: string;
    }
  | {
      kind: "compute_slot";
      slotKind: "field";
      base: Value;
      fieldOffset: number; // Byte offset from struct base
      dest: string;
    };

type ComputeOffset =
  | {
      kind: "compute_offset";
      offsetKind: "array";
      location: Location;
      base: Value;
      index: Value;
      stride: number; // Default: 32
      dest: string;
    }
  | {
      kind: "compute_offset";
      offsetKind: "field";
      location: Location;
      base: Value;
      field: string; // Field name (for debugging)
      fieldOffset: number; // Byte offset
      dest: string;
    }
  | {
      kind: "compute_offset";
      offsetKind: "byte";
      location: Location;
      base: Value;
      offset: Value; // Raw byte offset
      dest: string;
    };

type Slice = {
  kind: "slice";
  location: "memory";
  offset: Value;
  length: Value;
  dest: string;
};

// Note: Function calls are now block terminators, not regular instructions
// See Block.Terminator type definition for call terminator structure
```

## Block Terminators

Every basic block must end with exactly one terminator that explicitly transfers control:

```typescript
type Terminator =
  | { kind: "jump"; target: string }
  | { kind: "branch"; condition: Value; trueTarget: string; falseTarget: string }
  | { kind: "return"; value?: Value }
  | { kind: "call"; function: string; arguments: Value[]; dest?: string; continuation: string }
```

**Key points:**
- **Call terminators** split blocks at call sites, with explicit continuation blocks
- This ensures proper SSA form and explicit control flow
- Enables better interprocedural analysis and optimization

## Migration Path

1. **Phase 1**: Update IR specification with new instruction types
2. **Phase 2**: Update IR generation to emit new instructions
3. **Phase 3**: Update EVM generation to consume new instructions
4. **Phase 4**: Update optimization passes for new instruction format
5. **Phase 5**: Remove old instruction types

**Completed:** Function calls have been migrated from regular instructions to block terminators

## Benefits

- **Reduced complexity**: From ~12 different load/store instructions to 2 (read/write)
- **Better debugging**: Direct alignment with ethdebug format regions
- **Clearer semantics**: Location parameter makes data location explicit
- **Easier optimization**: Uniform instruction format simplifies pattern matching
- **Future-proof**: Easy to add new locations (e.g., new EVM features)
