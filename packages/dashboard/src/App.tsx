import { Route, Router } from "@solidjs/router";
import type { JSX } from "solid-js";
import Dashboard from "./pages/Dashboard.tsx";
import SandboxViewer from "./pages/SandboxViewer.tsx";
import "./styles.css";

export default function App(): JSX.Element {
  return (
    <Router base="/gui">
      <Route path="/" component={Dashboard} />
      <Route path="/sandbox/:id" component={SandboxViewer} />
    </Router>
  );
}
