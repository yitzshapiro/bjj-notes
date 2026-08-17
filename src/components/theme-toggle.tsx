"use client";

import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "bjj-notes-theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    localStorage.setItem(STORAGE_KEY, next);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      "content",
      next === "dark" ? "#09090b" : "#ffffff",
    );
  };

  return (
    <button
      className={`icon-button theme-toggle ${className}`.trim()}
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
    >
      <Moon className="theme-toggle__moon" size={17} />
      <Sun className="theme-toggle__sun" size={17} />
    </button>
  );
}
