import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Overlay } from "./Overlay";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el contenedor principal.");
const params = new URLSearchParams(window.location.search);
const overlayKind = params.has("captions") ? "captions" : params.has("visual-support") ? "visual-support" : null;
document.documentElement.dataset.surface = overlayKind ?? "app";
createRoot(root).render(<StrictMode>{overlayKind ? <Overlay kind={overlayKind} /> : <App />}</StrictMode>);
