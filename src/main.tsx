// perf must be imported first so its module-eval timestamp is the cold-start origin.
import { perf } from "./perf";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

perf.firstPaint();
