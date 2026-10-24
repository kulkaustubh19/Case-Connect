import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import "./profile-copy-feedback.js";
import "./ui-enhancements.js";
import { restoreSession } from "./session-restore.js";

restoreSession().finally(() => {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
