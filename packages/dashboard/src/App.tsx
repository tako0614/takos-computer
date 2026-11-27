import { Route, Router } from "@solidjs/router";
import type { JSX, ParentComponent } from "solid-js";
import Dashboard from "./pages/Dashboard.tsx";
import SandboxViewer from "./pages/SandboxViewer.tsx";
import { useI18n } from "./i18n.ts";
import "./styles.css";

const Layout: ParentComponent = (props) => {
  const { t } = useI18n();
  return (
    <>
      <a
        href="#main"
        class="skip-link"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById("main");
          main?.focus();
          main?.scrollIntoView();
        }}
      >
        {t("skipToContent")}
      </a>
      {props.children}
    </>
  );
};

export default function App(): JSX.Element {
  return (
    <Router base="/gui" root={Layout}>
      <Route path="/" component={Dashboard} />
      <Route path="/sandbox/:id" component={SandboxViewer} />
    </Router>
  );
}
