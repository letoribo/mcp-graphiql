import { useState, useEffect, useMemo, useRef } from "react";
import { GraphiQL } from "graphiql";
import { useEditorContext } from "@graphiql/react";
import { parse, print } from "graphql";
import "@graphiql/react/style.css";
import "graphiql/graphiql.css";
import "./App.css";

window.addEventListener("unhandledrejection", (event) => {
  if (event.reason === "Canceled" || event.reason?.message === "Canceled") {
    event.preventDefault();
  }
});

function isValidHttpUrl(string: string) {
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

interface IncomingTab {
  query: string;
  variables: string;
  headers: string;
}

function EditorBridge({ incomingQuery }: { incomingQuery: IncomingTab | null }) {
  const editorCtx = useEditorContext();
  const processedRef = useRef<IncomingTab | null>(null);

  useEffect(() => {
    if (!editorCtx || !incomingQuery || processedRef.current === incomingQuery) return;

    let retries = 0;
    const interval = setInterval(() => {
      retries++;
      if (editorCtx.queryEditor || retries > 20) {
        clearInterval(interval);
        if (!editorCtx.queryEditor) return;

        const currentVal = editorCtx.queryEditor.getValue() || "";

        if (!currentVal.trim()) {
          processedRef.current = incomingQuery;
          editorCtx.queryEditor.setValue(incomingQuery.query);
          if (editorCtx.variableEditor) editorCtx.variableEditor.setValue(incomingQuery.variables);
          if (editorCtx.headerEditor) editorCtx.headerEditor.setValue(incomingQuery.headers);
        } else if (typeof editorCtx.addTab === "function") {
          editorCtx.addTab();
          setTimeout(() => {
            if (editorCtx.queryEditor) {
              editorCtx.queryEditor.setValue(incomingQuery.query);
              if (editorCtx.variableEditor) editorCtx.variableEditor.setValue(incomingQuery.variables);
              if (editorCtx.headerEditor) editorCtx.headerEditor.setValue(incomingQuery.headers);
              processedRef.current = incomingQuery;
            }
          }, 100);
        }
      }
    }, 50);

    return () => clearInterval(interval);
  }, [editorCtx, incomingQuery]);

  return null;
}

export default function App() {
  const [url, setUrl] = useState<string>("");
  const [activeUrl, setActiveUrl] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [schemaKey, setSchemaKey] = useState<number>(0);
  const [isReloading, setIsReloading] = useState<boolean>(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState<boolean>(false);

  const [latestIncoming, setLatestIncoming] = useState<IncomingTab | null>(null);
  const isServerInitiated = useRef(false);

  useEffect(() => {
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith("graphiql:")) {
          localStorage.removeItem(key);
        }
      });
    } catch {}
  }, []);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (eventSource) eventSource.close();

      eventSource = new EventSource("http://localhost:6274/api/stream");

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "SCHEMA_UPDATED" || data.type === "MCP_SCHEMA_EVOLVED") {
            setIsReloading(true);
            setSchemaKey((prev) => prev + 1);
            setTimeout(() => {
              setIsReloading(false);
            }, 50);
          }

          if (data.endpoint) {
            isServerInitiated.current = true;
            setUrl(data.endpoint);
            setActiveUrl(data.endpoint);
            setIsSyncing(false);
          }

          if (data.query) {
            const formattedQuery = formatGraphQLQuery(data.query);
            if (formattedQuery.trim()) {
              const formattedVars = data.variables
                ? typeof data.variables === "string"
                  ? data.variables
                  : JSON.stringify(data.variables, null, 2)
                : "";
              const formattedHeaders = data.headers
                ? typeof data.headers === "string"
                  ? data.headers
                  : JSON.stringify(data.headers, null, 2)
                : "";

              setLatestIncoming({
                query: formattedQuery,
                variables: formattedVars,
                headers: formattedHeaders,
              });
            }
          }
        } catch (e) {
          console.error("Failed to parse SSE event:", e);
        }
      };

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 1000);
        }
      };
    };

    connect();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

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

  const fetcher = useMemo(() => {
    // console.log(`[FETCHER RECREATED] Active URL: ${activeUrl}, schemaKey: ${schemaKey}`);

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
        className="graphiql-wrapper"
        style={{ flex: 1, height: "100%", minHeight: 0, position: "relative", overflow: "hidden" }}
      >
        {activeUrl && !isReloading ? (
          <GraphiQL
            key={`${activeUrl}-${schemaKey}`}
            fetcher={fetcher}
            defaultTheme="dark"
            defaultQuery=""
          >
            <EditorBridge incomingQuery={latestIncoming} />
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
            {isReloading
              ? "Reloading GraphQL Schema..."
              : isSyncing
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