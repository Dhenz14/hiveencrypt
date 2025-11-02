import { Buffer } from "buffer";
import process from "process";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Polyfill Node.js globals for browser compatibility with Keychain SDK
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
  (window as any).process = process;
  (window as any).global = window;
}

createRoot(document.getElementById("root")!).render(<App />);
