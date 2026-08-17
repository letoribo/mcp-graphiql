import React from "react";
import ReactDOM from "react-dom/client";
import "graphiql/graphiql.css";
import "./App.css";
import App from "./App.tsx";

if (!sessionStorage.getItem("layout_reset_v1")) {
  localStorage.clear();
  sessionStorage.setItem("layout_reset_v1", "true");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);