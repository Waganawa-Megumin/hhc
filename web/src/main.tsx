import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { setUnauthorizedHandler } from "./api/httpAgentClient";
import "./i18n";
import "./styles.css";

// On any API 401 (expired/revoked session), bounce to the login screen.
setUnauthorizedHandler(() => {
  if (!location.pathname.startsWith("/login") && !location.pathname.startsWith("/mfa")) {
    location.assign("/login");
  }
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
