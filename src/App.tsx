import { useState, useMemo } from "react";
import { createGraphiQLFetcher } from "@graphiql/toolkit";
import { GraphiQL } from "graphiql";

// Точные пути к стилям для GraphiQL v3+
import "@graphiql/react/style.css"; 
import "graphiql/graphiql.css";

import "./App.css";

export default function App() {
  const [url, setUrl] = useState("");

  const fetcher = useMemo(() => {
    if (!url.trim()) {
      return () => Promise.resolve({ data: {} });
    }
    return createGraphiQLFetcher({ url: url.trim() });
  }, [url]);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Dynamic Endpoint Input Bar */}
      <div style={{ display: "flex", padding: "6px 12px", background: "#1e1e2e", borderBottom: "1px solid #45475a", alignItems: "center", gap: "8px" }}>
        <span style={{ color: "#cdd6f4", fontSize: "12px", fontWeight: "bold" }}>Endpoint:</span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/graphql"
          style={{
            flex: 1,
            padding: "4px 8px",
            background: "#11111b",
            color: "#cdd6f4",
            border: "1px solid #45475a",
            borderRadius: "4px",
            fontSize: "12px",
            fontFamily: "monospace",
            outline: "none"
          }}
        />
      </div>

      {/* GraphiQL Workspace */}
      <div className="graphiql-wrapper" style={{ flex: 1, height: "100%", minHeight: 0, position: "relative", overflow: "hidden" }}>
        <GraphiQL fetcher={fetcher} defaultTheme="dark" />
      </div>
    </div>
  );
}