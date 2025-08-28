import type { BytecodeOutput } from "../compiler/types";
import { formatBytecode } from "./formatBytecode";
import "./BytecodeView.css";

interface BytecodeViewProps {
  bytecode: BytecodeOutput;
}

export function BytecodeView({ bytecode }: BytecodeViewProps) {
  const runtimeHex = Array.from(bytecode.runtime)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const runtimeDisassembly = formatBytecode(runtimeHex);

  const constructorHex = bytecode.create
    ? Array.from(bytecode.create)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : null;
  const constructorDisassembly = constructorHex
    ? formatBytecode(constructorHex)
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
              <pre className="bytecode-hex">{bytecode.create}</pre>
            </div>

            <div className="bytecode-section">
              <h4>Disassembly</h4>
              <pre className="bytecode-disassembly">
                {constructorDisassembly}
              </pre>
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
          <pre className="bytecode-hex">{bytecode.runtime}</pre>
        </div>

        <div className="bytecode-section">
          <h4>Disassembly</h4>
          <pre className="bytecode-disassembly">{runtimeDisassembly}</pre>
        </div>
      </div>
    </div>
  );
}
