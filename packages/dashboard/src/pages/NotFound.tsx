import { createEffect, onCleanup } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import LanguageSwitcher from "../components/LanguageSwitcher.tsx";
import ThemeSwitcher from "../components/ThemeSwitcher.tsx";
import { useI18n } from "../i18n.ts";

export default function NotFound() {
  const { t } = useI18n();
  const location = useLocation();

  createEffect(() => {
    document.title = `${t("notFoundTitle")} — ${t("appTitle")}`;
  });
  onCleanup(() => {
    document.title = t("appTitle");
  });

  return (
    <div class="container">
      <header class="page-header">
        <A href="/" class="page-title page-title-link">
          takos computer
        </A>
        <div class="header-controls">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section class="card not-found-card" aria-labelledby="not-found-heading">
          <p class="not-found-code mono">404</p>
          <h1 id="not-found-heading" class="not-found-heading">
            {t("notFoundHeading")}
          </h1>
          <p class="not-found-desc muted">
            {t("notFoundDescription")}
          </p>
          <p class="not-found-path mono muted">{location.pathname}</p>
          <div class="not-found-actions">
            <A href="/" class="btn btn-primary">
              &larr; {t("backToSessions")}
            </A>
          </div>
        </section>
      </main>
    </div>
  );
}
