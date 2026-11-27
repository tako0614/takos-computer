import { For } from "solid-js";
import { type Language, useI18n } from "../i18n.ts";

const LANGUAGES: { label: string; value: Language }[] = [
  { label: "日本語", value: "ja" },
  { label: "English", value: "en" },
];

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      class="lang-switcher"
      role="group"
      aria-label={t("language")}
    >
      <For each={LANGUAGES}>
        {(lang) => (
          <button
            type="button"
            class="lang-btn"
            classList={{ active: language() === lang.value }}
            aria-pressed={language() === lang.value}
            onClick={() => setLanguage(lang.value)}
          >
            {lang.label}
          </button>
        )}
      </For>
    </div>
  );
}
