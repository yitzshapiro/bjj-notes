"use client";

import Link from "next/link";
import { BookOpen, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";

type AppHeaderProps = {
  compact?: boolean;
  title?: string;
  trailing?: React.ReactNode;
};

export function AppHeader({ compact = false, title, trailing }: AppHeaderProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className={`app-header ${compact ? "app-header--compact" : ""}`}>
      <div className="app-header__inner">
        <Link className="brand" href="/library" aria-label="Rollbook library">
          <span className="brand__mark" aria-hidden="true">
            <BookOpen size={19} strokeWidth={2.3} />
          </span>
          <span>Rollbook</span>
        </Link>
        {title ? <p className="app-header__title truncate">{title}</p> : null}
        <div className="app-header__actions">
          {trailing}
          <ThemeToggle />
          <button
            className="icon-button mobile-only"
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
          <Link className="button button--ghost desktop-only" href="/api/auth/signout">
            <LogOut size={16} />
            Sign out
          </Link>
        </div>
      </div>
      {open ? (
        <div className="mobile-menu">
          <Link className="button button--ghost" href="/api/auth/signout">
            <LogOut size={16} />
            Sign out
          </Link>
        </div>
      ) : null}
    </header>
  );
}
