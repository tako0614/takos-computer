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
      class="inline-flex rounded-lg"
      style="border:1px solid #334155; background:#0f172a; padding:0.125rem"
      aria-label={t("language")}
    >
      <For each={LANGUAGES}>
        {(lang) => (
          <button
            type="button"
            class="btn btn-sm"
            style={{
              background: language() === lang.value ? "#334155" : "transparent",
              color: language() === lang.value ? "#f1f5f9" : "#94a3b8",
            }}
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
