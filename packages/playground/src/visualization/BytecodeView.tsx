import type { BytecodeOutput } from "../compiler/types";
import type { Evm } from "@ethdebug/bugc";
import { extractSourceRange, type SourceRange } from "./debugUtils";
import "./BytecodeView.css";

interface BytecodeViewProps {
  bytecode: BytecodeOutput;
  onOpcodeHover?: (ranges: SourceRange[]) => void;
}

function DisassemblyView({
  instructions,
  onOpcodeHover,
}: {
  instructions: Evm.Instruction[];
  onOpcodeHover?: (ranges: SourceRange[]) => void;
}) {
  let pc = 0;

  return (
    <div className="bytecode-disassembly-interactive">
      {instructions.map((instruction, idx) => {
        const currentPc = pc;
        pc += 1 + (instruction.immediates?.length || 0);

        const sourceRanges = extractSourceRange(instruction.debug?.context);
        const hasDebugInfo = sourceRanges.length > 0;

        return (
          <div
            key={idx}
            className={`opcode-line ${hasDebugInfo ? "has-debug-info" : ""}`}
            onMouseEnter={() => onOpcodeHover?.(sourceRanges)}
            onMouseLeave={() => onOpcodeHover?.([])}
          >
            <span className="pc">{currentPc.toString().padStart(4, "0")}</span>
            <span className="opcode">{instruction.mnemonic}</span>
            {instruction.immediates && instruction.immediates.length > 0 && (
              <span className="immediates">
                0x
                {instruction.immediates
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BytecodeView({ bytecode, onOpcodeHover }: BytecodeViewProps) {
  const runtimeHex = Array.from(bytecode.runtime)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const constructorHex = bytecode.create
    ? Array.from(bytecode.create)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : null;

  return (
    <div className="bytecode-view">
      {bytecode.create && (
        <>
          <div className="bytecode-header">
            <h3>Constructor Bytecode</h3>
            <div className="bytecode-stats">
              <span>Size: {bytecode.create.length / 2} bytes</span>
            </div>
          </div>

          <div className="bytecode-content">
            <div className="bytecode-section">
              <h4>Hex</h4>
              <pre className="bytecode-hex">{constructorHex}</pre>
            </div>

            <div className="bytecode-section">
              <h4>Disassembly</h4>
              {bytecode.createInstructions && (
                <DisassemblyView
                  instructions={bytecode.createInstructions}
                  onOpcodeHover={onOpcodeHover}
                />
              )}
            </div>
          </div>

          <hr className="bytecode-separator" />
        </>
      )}

      <div className="bytecode-header">
        <h3>{bytecode.create ? "Runtime Bytecode" : "EVM Bytecode"}</h3>
        <div className="bytecode-stats">
          <span>Size: {bytecode.runtime.length / 2} bytes</span>
        </div>
      </div>

      <div className="bytecode-content">
        <div className="bytecode-section">
          <h4>Hex</h4>
          <pre className="bytecode-hex">{runtimeHex}</pre>
        </div>

        <div className="bytecode-section">
          <h4>Disassembly</h4>
          <DisassemblyView
            instructions={bytecode.runtimeInstructions}
            onOpcodeHover={onOpcodeHover}
          />
        </div>
      </div>
    </div>
  );
}
