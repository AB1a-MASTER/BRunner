import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../../shared/studio-tokens.css";
import "./studio.css";
import { GraphStudio } from "./GraphStudio.jsx";
import { initializeStudioPreferences } from "../../core/studioPreferencesBootstrap.js";

initializeStudioPreferences();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <GraphStudio />
  </StrictMode>,
);
