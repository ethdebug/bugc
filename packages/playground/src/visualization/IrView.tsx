import type { IrModule } from "@ethdebug/bugc";
import { IrFormatter } from "./formatIr";
import "./IrView.css";

interface IrViewProps {
  ir: IrModule;
  optimized?: boolean;
}

export function IrView({ ir, optimized = false }: IrViewProps) {
  const formatter = new IrFormatter();
  const formatted = formatter.format(ir);

  // Calculate stats for all functions
  const mainBlocks = ir.main.blocks.size;
  const mainLocals = ir.main.locals.length;
  const createBlocks = ir.create?.blocks.size || 0;
  const createLocals = ir.create?.locals.length || 0;

  // Count user-defined functions
  const userFunctionCount = ir.functions?.size || 0;
  let userFunctionBlocks = 0;
  let userFunctionLocals = 0;
  if (ir.functions) {
    for (const func of ir.functions.values()) {
      userFunctionBlocks += func.blocks.size;
      userFunctionLocals += func.locals.length;
    }
  }

  return (
    <div className="ir-view">
      <div className="ir-header">
        <h3>{optimized ? "Optimized IR" : "Unoptimized IR"}</h3>
        <div className="ir-stats">
          {userFunctionCount > 0 && (
            <span>
              Functions: {userFunctionCount} ({userFunctionBlocks} blocks,{" "}
              {userFunctionLocals} locals)
            </span>
          )}
          {ir.create && (
            <span>
              Create: {createBlocks} blocks, {createLocals} locals
            </span>
          )}
          <span>
            Main: {mainBlocks} blocks, {mainLocals} locals
          </span>
        </div>
      </div>
      <pre className="ir-code">{formatted}</pre>
    </div>
  );
}
