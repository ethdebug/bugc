import type * as Ir from "#ir";
import type { Stack } from "#evm";
import type { Transition } from "../../operations/index.js";
import {
  pipe,
  operations,
  rebrand,
  rebrandTop,
} from "../../operations/index.js";
import { loadValue, storeValueIfNeeded, valueId } from "../values/index.js";
import {
  allocateMemoryDynamic,
  getSliceElementSize,
  getSliceDataOffset,
} from "../memory/index.js";
import { EvmError, EvmErrorCode } from "../../errors.js";
import { Severity } from "#result";

const { PUSHn, MUL, ADD, SUB, DUP1, SWAP1, SWAP3, MCOPY, CALLDATACOPY } =
  operations;

/**
 * Generate code for slice operations
 */
export function generateSlice<S extends Stack>(
  inst: Ir.SliceInstruction,
): Transition<S, readonly ["value", ...S]> {
  const objectId = valueId(inst.object);

  // Check if it's calldata by looking at the value id pattern
  // Calldata values typically come from msg_data or function arguments
  const isCalldata =
    objectId.includes("calldata") ||
    objectId.includes("msg_data") ||
    objectId.includes("msg.data");

  const source: "calldata" | "memory" = isCalldata ? "calldata" : "memory";

  return pipe<S>()
    .peek((state, builder) => {
      const isInMemory =
        objectId in state.memory.allocations ||
        state.stack.findIndex(({ irValue }) => irValue === objectId) > -1;

      if (!isInMemory && !isCalldata) {
        // Storage array - need to load each element
        // This is more complex, so for now we'll implement the memory case
        // and add a warning for storage arrays
        return builder.err(
          new EvmError(
            EvmErrorCode.UNSUPPORTED_INSTRUCTION,
            "Slice of storage arrays not yet implemented",
            inst.loc,
            Severity.Error,
          ),
        );
      }
      return builder;
    })
    .then(loadValue(inst.start), { as: "startIndex" })
    .then(DUP1())
    .then(loadValue(inst.end), { as: "endIndex" })
    .then(allocateSlice(inst.object))
    .then(DUP1())
    .then(SWAP3(), { as: "startIndex" })
    .then(computeSliceStartOffset(inst.object), { as: "offset" })
    .then(SWAP1(), { as: "destOffset" })
    .then(rebrand({ 3: "size" } as const))
    .then(performCopyFrom(source))
    .then(rebrandTop("value"))
    .then(storeValueIfNeeded(inst.dest))
    .done();
}

/**
 * Allocate memory for a slice
 */
function allocateSlice<S extends Stack>(
  object: Ir.Value,
): Transition<
  readonly ["endIndex", "startIndex", ...S],
  readonly ["allocatedOffset", "totalSize", ...S]
> {
  const elementSize = getSliceElementSize(object.type);

  return (
    pipe<readonly ["endIndex", "startIndex", ...S]>()
      // Calculate length = end - start
      .then(
        rebrand({
          1: "a",
          2: "b",
        } as const),
      )
      .then((state) => state)
      .then(SUB(), { as: "b" })

      // Calculate byte size = length * element_size
      .then(PUSHn(elementSize), { as: "a" })
      .then(MUL(), { as: "totalSize" })

      // preserve total bytes size
      .then(DUP1(), { as: "size" })

      // Allocate memory dynamically
      .then(allocateMemoryDynamic(), { as: "allocatedOffset" })
      .then((state) => state)
      .done()
  );
}

/**
 * Compute the starting offset for a slice
 */
function computeSliceStartOffset<S extends Stack>(
  object: Ir.Value,
): Transition<readonly ["startIndex", ...S], readonly ["startOffset", ...S]> {
  const elementSize = getSliceElementSize(object.type);
  const dataOffset = getSliceDataOffset(object.type);

  return (
    pipe<readonly ["startIndex", ...S]>()
      .then(rebrandTop("b"))
      // Multiply start index by element size
      .then(PUSHn(elementSize), { as: "a" })
      .then(MUL(), { as: "b" })

      // Load the base pointer to the object
      .then(loadValue(object), { as: "a" })
      .then(ADD(), { as: "offset" })

      // Add data offset if needed (for dynamic bytes/strings)
      .then(
        dataOffset > 0n
          ? pipe<readonly ["offset", ...S]>()
              .then(rebrandTop("b"))
              .then(PUSHn(dataOffset), { as: "a" })
              .then(ADD(), { as: "startOffset" })
              .done()
          : pipe<readonly ["offset", ...S]>()
              .then(rebrandTop("startOffset"))
              .done(),
      )
      .done()
  );
}

/**
 * Perform copy operation from memory or calldata
 */
function performCopyFrom<S extends Stack>(
  source: "memory" | "calldata",
): Transition<
  readonly ["destOffset", "offset", "size", ...S],
  readonly [...S]
> {
  const COPY = source === "memory" ? MCOPY : CALLDATACOPY;
  return pipe<["destOffset", "offset", "size", ...S]>().then(COPY()).done();
}
