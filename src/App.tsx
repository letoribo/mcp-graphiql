import { useState, useEffect, useMemo } from "react";
import { GraphiQL } from "graphiql";

import "@graphiql/react/style.css"; 
import "graphiql/graphiql.css";

import "./App.css";

function isValidHttpUrl(string: string) {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function App() {
  const [url, setUrl] = useState<string>("");
  const [activeUrl, setActiveUrl] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [schemaKey, setSchemaKey] = useState<number>(0);
  const [isConfigLoaded, setIsConfigLoaded] = useState<boolean>(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get("endpoint") || params.get("url");

    if (urlParam) {
      setUrl(urlParam);
      setActiveUrl(urlParam);
      setIsConfigLoaded(true);
      return;
    }

    fetch("http://localhost:3000/api/config")
      .then((res) => res.json())
      .then((data) => {
        if (data?.defaultEndpoint) {
          setUrl(data.defaultEndpoint);
          setActiveUrl(data.defaultEndpoint);
        }
      })
      .catch((err) => console.error("Failed to load config:", err))
      .finally(() => setIsConfigLoaded(true));
  }, []);

  useEffect(() => {
    if (!url) {
      setErrorMessage("");
      return;
    }

    if (url === activeUrl) return;

    // Быстрая проверка формата на клиенте
    if (!isValidHttpUrl(url)) {
      setErrorMessage("ENDPOINT must be a valid HTTP/HTTPS URL");
      return;
    }

    setErrorMessage("");
    setIsSyncing(true);

    const timer = setTimeout(() => {
      fetch("http://localhost:3000/api/switch-endpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: url }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setActiveUrl(url);
            setSchemaKey((prev) => prev + 1);
            setErrorMessage("");
          } else {
            setErrorMessage(data.error || "ENDPOINT must be a valid URL");
          }
        })
        .catch((err) => {
          setErrorMessage(err?.message || "Failed to connect to config server");
        })
        .finally(() => setIsSyncing(false));
    }, 800);

    return () => clearTimeout(timer);
  }, [url, activeUrl]);

  const fetcher = useMemo(() => {
    return async (graphQLParams: any, opts?: any) => {
      const activeEndpoint = "http://localhost:6274/graphiql";

      try {
        const res = await fetch(activeEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(opts?.headers || {}),
          },
          body: JSON.stringify(graphQLParams),
        });

        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return { errors: [{ message: text || `Status: ${res.status}` }] };
        }
      } catch (err: any) {
        return { errors: [{ message: err?.message || "Bridge offline or syncing..." }] };
      }
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top Input Bar */}
      <div
        style={{
          display: "flex",
          padding: "6px 12px",
          background: "#1e1e2e",
          borderBottom: "1px solid #45475a",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span style={{ color: "#cdd6f4", fontSize: "12px", fontWeight: "bold" }}>Endpoint:</span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={isConfigLoaded ? "Paste GraphQL endpoint URL..." : "Loading config..."}
          style={{
            flex: 1,
            padding: "4px 8px",
            background: "#11111b",
            color: "#cdd6f4",
            border: `1px solid ${errorMessage ? "#f38ba8" : "#45475a"}`,
            borderRadius: "4px",
            fontSize: "12px",
            fontFamily: "monospace",
            outline: "none",
          }}
        />
        {isSyncing && (
          <span style={{ color: "#f9e2af", fontSize: "11px", fontFamily: "monospace" }}>
            Syncing schema...
          </span>
        )}
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div
          style={{
            background: "#f38ba8",
            color: "#11111b",
            padding: "4px 12px",
            fontSize: "12px",
            fontWeight: "bold",
            fontFamily: "monospace",
          }}
        >
          ⚠️ {errorMessage}
        </div>
      )}

      {/* GraphiQL Canvas */}
      <div
        className="graphiql-wrapper"
        style={{ flex: 1, height: "100%", minHeight: 0, position: "relative", overflow: "hidden" }}
      >
        {activeUrl && !errorMessage ? (
          <GraphiQL key={`${activeUrl}-${schemaKey}`} fetcher={fetcher} defaultTheme="dark" />
        ) : (
          <div
            style={{
              display: "flex",
              height: "100%",
              alignItems: "center",
              justifyContent: "center",
              color: "#a6adc8",
              fontFamily: "sans-serif",
              fontSize: "14px",
            }}
          >
            {errorMessage
              ? "Fix the endpoint URL above to continue."
              : "Enter a valid GraphQL endpoint URL in the bar above to start."}
          </div>
        )}
      </div>
    </div>
  );
}