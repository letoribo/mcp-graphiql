# 🚀 mcp-graphiql

**mcp-graphiql** is a standalone, CORS-free **Electron desktop app** and GraphiQL playground that acts as a real-time visual companion for AI agents (Claude Desktop, Antigravity, etc.).

By embedding [mcp-graphql-enhanced](https://www.npmjs.com/package/@letoribo/mcp-graphql-enhanced), it bridges the gap between AI assistants and live GraphQL environments — streaming queries and schema updates directly into interactive tabs as your AI agent works.

---

## ✨ Features

- **🖥️ Desktop GraphiQL Environment:** Built on Electron — bypasses browser CORS restrictions and origin limitations.
- **⚡ Hot-Reloading & Live Streaming:** Tool calls (`query-graphql`) stream directly into new query tabs, while schema calls (`introspect-schema`) hot-reload and update the Docs explorer in real-time when switching target endpoints.
- **🔌 Embedded MCP Gateway:** Boots an internal `@letoribo/mcp-graphql-enhanced` server exposing an HTTP/SSE endpoint at `http://localhost:6274/mcp`.
- **🔄 Universal AI Bridge:** Connects seamlessly with Antigravity (native HTTP/SSE) and Claude Desktop (via `mcp-remote`).

---

## 🚀 Quickstart

### Installation & Launch

Clone the repository and install dependencies:

```bash
git clone git@github.com:letoribo/mcp-graphiql.git
cd mcp-graphiql
npm install
```

Running **`mcp-graphiql`** boots an embedded `@letoribo/mcp-graphql-enhanced` server and exposes the sync endpoint at `http://localhost:6274/mcp`.

From the repo root:

```bash
ENDPOINT="https://api.github.com/graphql" \
HEADERS='{"Authorization":"Bearer YOUR_PAT"}' \
npm run electron:dev
```

### 🛠️️ Client Configuration

Once `mcp-graphiql` is running and hosting the HTTP server at `http://localhost:6274/mcp`:

#### 1. Antigravity (Direct HTTP/SSE)
Antigravity supports HTTP/SSE endpoints natively:

```json
{
  "mcpServers": {
    "mcp-graphiql": {
      "url": "http://localhost:6274/mcp"
    }
  }
}
```

#### 2. Claude Desktop (via mcp-remote)
Since Claude Desktop currently expects stdio commands, bridge the HTTP endpoint using mcp-remote:

```json
{
  "mcpServers": {
    "mcp-graphiql": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:6274/mcp"
      ]
    }
  }
}
```

> Note on Synchronization: 
The mcp-graphiql HTTP server at http://localhost:6274/mcp is responsible for bridging real-time query events between the AI client and the Electron playground UI.

## 📖 How to Use

1. It is recommended to begin with `introspect-schema` so the AI client understands the GraphQL API context. Passing a new `endpoint` parameter will automatically hot-reload the schema and refresh the **Docs Explorer** in `mcp-graphiql`.
2. Ask your agent to run queries:
   > *"Execute `query-graphql` to fetch my GitHub profile info"*
3. A new tab containing the formatted GraphQL query and live API response will automatically pop up in the Electron UI.
