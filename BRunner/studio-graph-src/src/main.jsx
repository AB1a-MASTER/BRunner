import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./studio.css";
import { GraphStudio } from "./GraphStudio.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <GraphStudio />
  </StrictMode>,
);
