import React from "react";
import ReactDOM from "react-dom/client";
import "graphiql/graphiql.css";
import "./App.css";
import App from "./App.tsx";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import graphqlWorker from "monaco-graphql/esm/graphql.worker?worker";

// Configure Monaco Environment for GraphiQL and Vite / Electron workers
(window as any).MonacoEnvironment = {
  getWorker(_: any, label: string) {
    if (label === "graphql") {
      return new graphqlWorker();
    }
    if (label === "json") {
      return new jsonWorker();
    }
    return new editorWorker();
  },
};

if (!sessionStorage.getItem("layout_reset_v1")) {
  localStorage.clear();
  sessionStorage.setItem("layout_reset_v1", "true");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);