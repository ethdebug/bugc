import MonacoEditor from "@monaco-editor/react";
import { useEffect } from "react";
import { registerBugLanguage } from "./bugLanguage";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
}

export function Editor({ value, onChange, language = "bug" }: EditorProps) {
  useEffect(() => {
    registerBugLanguage();
  }, []);

  return (
    <MonacoEditor
      height="100%"
      language={language}
      theme="vs-dark"
      value={value}
      onChange={(value) => onChange(value || "")}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
      }}
    />
  );
}
