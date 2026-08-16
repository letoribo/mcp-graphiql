import { useState } from "react";
import { createGraphiQLFetcher } from "@graphiql/toolkit";
import { GraphiQL } from "graphiql";
import { useEditorContext } from "@graphiql/react";
import "graphiql/graphiql.css";

const fetcher = createGraphiQLFetcher({ url: "http://localhost:3000" });

function QuickPasteBox() {
  const [open, setOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = (useEditorContext as any)();

  const handleApply = () => {
    const editor = context?.queryEditor || context?.editor;
    if (editor?.setValue && rawText) {
      editor.setValue(rawText);
      setRawText("");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button 
        type="button"
        onClick={() => setOpen(true)}
        style={{ padding: "4px 8px", background: "#45475a", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}
      >
        📝 Поле вставки
      </button>
    );
  }

  return (
    <div style={{ position: "absolute", zIndex: 9999, top: 40, left: 10, background: "#1e1e2e", padding: 10, border: "1px solid #45475a", borderRadius: 6, display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        autoFocus
        rows={6}
        cols={45}
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="Вставляй Ctrl+V сюда — обычный textarea работает всегда"
        style={{ background: "#11111b", color: "#cdd6f4", border: "1px solid #45475a", padding: 8, fontFamily: "monospace", fontSize: "12px" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={handleApply} style={{ background: "#a6e3a1", color: "#11111b", border: "none", padding: "4px 10px", cursor: "pointer", fontWeight: "bold" }}>
          Применить
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ background: "#f38ba8", color: "#11111b", border: "none", padding: "4px 10px", cursor: "pointer" }}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <GraphiQL fetcher={fetcher}>
        <GraphiQL.Logo>
          <QuickPasteBox />
        </GraphiQL.Logo>
      </GraphiQL>
    </div>
  );
}