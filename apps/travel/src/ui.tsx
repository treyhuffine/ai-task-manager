/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RiAppProvider } from "@ri/app-kit/ui";
import { TravelApp } from "./view/app.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RiAppProvider>
      <TravelApp />
    </RiAppProvider>
  </StrictMode>,
);
