import { Ir } from "@ethdebug/bugc";
import "./IrView.css";

interface IrViewProps {
  ir: Ir.Module;
  optimized?: boolean;
}

export function IrView({ ir, optimized = false }: IrViewProps) {
  const formatter = new Ir.Analysis.Formatter();
  const formatted = formatter.format(ir);

  // Calculate stats for all functions
  const mainBlocks = ir.main.blocks.size;
  const createBlocks = ir.create?.blocks.size || 0;

  // Count user-defined functions
  const userFunctionCount = ir.functions?.size || 0;
  let userFunctionBlocks = 0;
  if (ir.functions) {
    for (const func of ir.functions.values()) {
      userFunctionBlocks += func.blocks.size;
    }
  }

  return (
    <div className="ir-view">
      <div className="ir-header">
        <h3>{optimized ? "Optimized IR" : "Unoptimized IR"}</h3>
        <div className="ir-stats">
          {userFunctionCount > 0 && (
            <span>
              Functions: {userFunctionCount} ({userFunctionBlocks} blocks)
            </span>
          )}
          {ir.create && <span>Create: {createBlocks} blocks</span>}
          <span>Main: {mainBlocks} blocks</span>
        </div>
      </div>
      <pre className="ir-code">{formatted}</pre>
    </div>
  );
}
