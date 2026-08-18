"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, History, LogOut, Map, Menu, Search, Swords, Target, X } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";

type AppHeaderProps = {
  compact?: boolean;
  title?: string;
  trailing?: React.ReactNode;
};

const navItems = [
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/divisions", label: "Divisions", icon: Search },
  { href: "/plans", label: "Plans", icon: Map },
  { href: "/game", label: "My Game", icon: Swords },
  { href: "/focus", label: "Focus", icon: Target },
  { href: "/history", label: "History", icon: History },
];

export function AppHeader({ compact = false, title, trailing }: AppHeaderProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className={`app-header ${compact ? "app-header--compact" : ""}`}>
      <div className="app-header__inner">
        <Link className="brand" href="/library" aria-label="BJJ Notes library">
          <span className="brand__mark" aria-hidden="true">
            <BookOpen size={16} strokeWidth={2.4} />
          </span>
          <span>BJJ Notes</span>
        </Link>
        <nav className="app-nav desktop-only" aria-label="Sections">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? "is-active" : ""}
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
            >
              <item.icon size={14} />
              {item.label}
            </Link>
          ))}
        </nav>
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
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link className="button button--ghost desktop-only" href="/api/auth/signout">
            <LogOut size={15} />
            Sign out
          </Link>
        </div>
      </div>
      {open ? (
        <div className="mobile-menu">
          {navItems.map((item) => (
            <Link key={item.href} className="button button--ghost" href={item.href} onClick={() => setOpen(false)}>
              <item.icon size={15} />
              {item.label}
            </Link>
          ))}
          <Link className="button button--ghost" href="/api/auth/signout">
            <LogOut size={15} />
            Sign out
          </Link>
        </div>
      ) : null}
    </header>
  );
}
