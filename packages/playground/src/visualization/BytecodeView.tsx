import type { BytecodeOutput } from "../compiler/types";
import type { Evm } from "@ethdebug/bugc";
import { extractSourceRange, type SourceRange } from "./debugUtils";
import { useState, useRef, useEffect } from "react";
import "./BytecodeView.css";

interface BytecodeViewProps {
  bytecode: BytecodeOutput;
  onOpcodeHover?: (ranges: SourceRange[]) => void;
}

function InstructionsView({
  instructions,
  onOpcodeHover,
}: {
  instructions: Evm.Instruction[];
  onOpcodeHover?: (ranges: SourceRange[]) => void;
}) {
  const [tooltip, setTooltip] = useState<{
    content: string;
    x: number;
    y: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tooltip && tooltipRef.current) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let { x, y } = tooltip;

      // Adjust horizontal position if tooltip goes off right edge
      if (x + tooltipRect.width > viewportWidth) {
        x = viewportWidth - tooltipRect.width - 10;
      }

      // Adjust horizontal position if tooltip goes off left edge
      if (x < 10) {
        x = 10;
      }

      // Adjust vertical position if tooltip goes off bottom edge
      if (y + tooltipRect.height > viewportHeight) {
        y = viewportHeight - tooltipRect.height - 10;
      }

      // Adjust vertical position if tooltip goes off top edge
      if (y < 10) {
        y = 10;
      }

      // Update position if it changed
      if (x !== tooltip.x || y !== tooltip.y) {
        setTooltip({ ...tooltip, x, y });
      }
    }
  }, [tooltip]);

  let pc = 0;

  const handleOpcodeMouseEnter = (sourceRanges: SourceRange[]) => {
    onOpcodeHover?.(sourceRanges);
  };

  const handleOpcodeMouseLeave = () => {
    onOpcodeHover?.([]);
  };

  const handleDebugIconMouseEnter = (
    e: React.MouseEvent<HTMLSpanElement>,
    instruction: Evm.Instruction,
  ) => {
    if (instruction.debug?.context) {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({
        content: JSON.stringify(instruction.debug.context, null, 2),
        x: rect.left,
        y: rect.bottom,
      });
    }
  };

  const handleDebugIconMouseLeave = () => {
    setTooltip(null);
  };

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
            onMouseEnter={() => handleOpcodeMouseEnter(sourceRanges)}
            onMouseLeave={handleOpcodeMouseLeave}
          >
            {hasDebugInfo ? (
              <span
                className="debug-info-icon"
                onMouseEnter={(e) => handleDebugIconMouseEnter(e, instruction)}
                onMouseLeave={handleDebugIconMouseLeave}
              >
                ℹ
              </span>
            ) : (
              <span className="debug-info-spacer"></span>
            )}
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
      {tooltip && (
        <div
          ref={tooltipRef}
          className="ethdebug-tooltip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          <pre>{tooltip.content}</pre>
        </div>
      )}
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
              <h4>Instructions</h4>
              {bytecode.createInstructions && (
                <InstructionsView
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
          <h4>Instructions</h4>
          <InstructionsView
            instructions={bytecode.runtimeInstructions}
            onOpcodeHover={onOpcodeHover}
          />
        </div>
      </div>
    </div>
  );
}
