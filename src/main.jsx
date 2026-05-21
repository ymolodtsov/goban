import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import GobanGame from "./goban.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <GobanGame />
  </StrictMode>
);
