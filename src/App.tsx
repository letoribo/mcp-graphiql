import { useState, useEffect, useMemo, useRef } from "react";
import { useOperationsEditorState } from '@graphiql/react';
import { GraphiQL } from "graphiql";
import { parse, print } from "graphql";
import "graphiql/style.css";
import "./App.css";

// Prevent unhandled cancellations from crashing the app
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason === "Canceled" || event.reason?.message === "Canceled") {
    event.preventDefault();
  }
});

function isValidHttpUrl(string: string): boolean {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatGraphQLQuery(queryStr: string): string {
  if (!queryStr || !queryStr.trim()) return "";
  try {
    return print(parse(queryStr));
  } catch {
    return queryStr;
  }
}

// Bridge component that programmatically opens a new tab or syncs query into active tab
function ActiveTabQueryUpdater({ query }: { query: string }) {
  const [, setQuery] = useOperationsEditorState();
  const lastQueryRef = useRef<string>("");

  useEffect(() => {
    if (!query || query === lastQueryRef.current) return;
    lastQueryRef.current = query;

    console.log("[ActiveTabQueryUpdater] Processing incoming query:", query);

    // Try to find and click the GraphiQL native "Add Tab" button (+) to open a fresh tab for each curl request
    const addTabButton = document.querySelector('.graphiql-tab-add, button[aria-label="New tab"], .graphiql-workspace-tab-add') as HTMLButtonElement;
    if (addTabButton) {
      addTabButton.click();
    }

    // Short timeout to let the new tab mount its editor instance, then set the query
    setTimeout(() => {
      try {
        if (typeof setQuery === 'function') {
          setQuery(query);
        }
      } catch (err) {
        console.warn("[ActiveTabQueryUpdater] Could not update editor state:", err);
      }
    }, 60);
  }, [query, setQuery]);

  return null;
}

export default function App() {
  const [url, setUrl] = useState<string>("");
  const [activeUrl, setActiveUrl] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [schemaKey, setSchemaKey] = useState<number>(0);
  const [isConfigLoaded, setIsConfigLoaded] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");

  const isServerInitiated = useRef(false);

  // Clear stale GraphiQL local storage cache on mount
  useEffect(() => {
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith("graphiql:")) {
          localStorage.removeItem(key);
        }
      });
    } catch {}
  }, []);

  // SSE client listener for backend query broadcasts (curl / MCP)
  useEffect(() => {
    const eventSource = new EventSource("http://localhost:6274/api/stream");

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const rawQuery = data?.query;
        if (rawQuery) {
          const formattedQuery = formatGraphQLQuery(rawQuery);
          if (formattedQuery.trim()) {
            setQuery(formattedQuery);
          }
        }
      } catch (err) {
        console.error("[SSE] Failed to parse event data:", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Fallback Electron IPC listener
  useEffect(() => {
    const win = window as any;
    if (win.electronAPI && typeof win.electronAPI.on === "function") {
      const unsubscribe = win.electronAPI.on("mcp:set-query", (...args: any[]) => {
        const data = args[0];
        const rawQuery = data?.query || data?.args?.query;
        if (rawQuery) {
          const formattedQuery = formatGraphQLQuery(rawQuery);
          if (formattedQuery.trim()) {
            setQuery(formattedQuery);
          }
        }
      });

      return () => {
        unsubscribe();
      };
    }
  }, []);

  // Initialize endpoint from query params or config server
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get("endpoint") || params.get("url");

    if (urlParam) {
      setUrl(urlParam);
      setIsConfigLoaded(true);
      return;
    }

    fetch("http://localhost:6274/api/config")
      .then((res) => res.json())
      .then((data) => {
        const defaultUrl = data?.defaultEndpoint || data?.endpoint || "";
        if (defaultUrl) {
          setUrl(defaultUrl);
          setActiveUrl(defaultUrl);
        }
      })
      .catch(() => setUrl(""))
      .finally(() => setIsConfigLoaded(true));
  }, []);

  // Handle endpoint switching with debounce
  useEffect(() => {
    if (!url) {
      setErrorMessage("");
      setActiveUrl("");
      return;
    }

    if (isServerInitiated.current) {
      isServerInitiated.current = false;
      return;
    }

    if (url === activeUrl) return;

    if (!isValidHttpUrl(url)) {
      setErrorMessage("ENDPOINT must be a valid HTTP/HTTPS URL");
      return;
    }

    setErrorMessage("");
    setIsSyncing(true);

    const timer = setTimeout(() => {
      fetch("http://localhost:6274/api/switch-endpoint", {
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
        .finally(() => {
          setIsSyncing(false);
        });
    }, 400);

    return () => clearTimeout(timer);
  }, [url, activeUrl]);

  // Custom GraphQL fetcher routing through local proxy
  const fetcher = useMemo(() => {
    return async (graphQLParams: any, opts?: any) => {
      if (!graphQLParams?.query || !graphQLParams.query.trim()) {
        return { data: null };
      }

      const target = activeUrl?.trim() || url?.trim();

      if (!target || target.includes("localhost:6274") || target.includes("127.0.0.1:6274")) {
        return { data: null };
      }

      const proxyEndpoint = "http://localhost:6274/graphql";

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch(proxyEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-target-endpoint": target,
              "x-schema-version": String(schemaKey),
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
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          return { errors: [{ message: err?.message || "Bridge offline or syncing..." }] };
        }
      }
    };
  }, [activeUrl, url, schemaKey]);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top endpoint toolbar */}
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
          onChange={(e) => {
            isServerInitiated.current = false;
            setUrl(e.target.value);
          }}
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

      <div
        className="graphiql-container theme-dark graphiql-wrapper"
        style={{ flex: 1, height: "100%", minHeight: 0, position: "relative", overflow: "hidden" }}
      >
        {activeUrl ? (
          <GraphiQL
            key={`${activeUrl}-${schemaKey}`}
            fetcher={fetcher}
          >
            <ActiveTabQueryUpdater query={query} />
          </GraphiQL>
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
            {isSyncing
              ? "Connecting to endpoint & fetching schema..."
              : errorMessage
              ? "Fix the endpoint URL above to continue."
              : "Enter a valid GraphQL endpoint URL in the bar above to start."}
          </div>
        )}
      </div>
    </div>
  );
}