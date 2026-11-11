import React from "react";
import ReactDOM from "react-dom/client";
import "graphiql/style.css";
import "./App.css";
import App from "./App.tsx";

if (typeof window !== "undefined") {
  // @ts-ignore
  window.MonacoEnvironment = {
    getWorker(_moduleId: string, _label: string) {
      const workerCode = `
        self.onmessage = function() {
          // Fallback worker message handler
        };
      `;
      const blob = new Blob([workerCode], { type: "application/javascript" });
      return new Worker(URL.createObjectURL(blob));
    },
  };
}

if (!sessionStorage.getItem("layout_reset_v1")) {
  localStorage.clear();
  sessionStorage.setItem("layout_reset_v1", "true");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);