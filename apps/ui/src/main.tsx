import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import "./index.css";
import "@xyflow/react/dist/style.css";
import { queryClient } from "./api/queries";
import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
