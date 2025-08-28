import type { Program } from "@ethdebug/bugc";
import "./AstView.css";

interface AstViewProps {
  ast: Program;
}

export function AstView({ ast }: AstViewProps) {
  // Format AST as JSON, excluding parent references to avoid circular structure
  const astJson = JSON.stringify(
    ast,
    (key, value) => {
      if (key === "parent") return undefined;
      return value;
    },
    2,
  );

  return (
    <div className="ast-view">
      <pre className="ast-json">{astJson}</pre>
    </div>
  );
}
