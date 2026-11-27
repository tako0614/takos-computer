import { useI18n } from "../i18n.ts";
import { type ThemePreference, useTheme } from "../lib/theme.ts";

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  labelKey: "themeSystem" | "themeLight" | "themeDark";
}> = [
  { value: "system", labelKey: "themeSystem" },
  { value: "light", labelKey: "themeLight" },
  { value: "dark", labelKey: "themeDark" },
];

export default function ThemeSwitcher() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <div
      class="lang-switcher theme-switcher"
      role="group"
      aria-label={t("theme")}
    >
      {THEME_OPTIONS.map((option) => (
        <button
          type="button"
          class={`lang-btn${theme() === option.value ? " active" : ""}`}
          aria-pressed={theme() === option.value}
          onClick={() => setTheme(option.value)}
        >
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  );
}
