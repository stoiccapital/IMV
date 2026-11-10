import {
  Archive,
  BookOpenText,
  ChevronDown,
  ClipboardCheck,
  FileBarChart,
  FolderKanban,
  LogOut,
  Menu,
  PanelLeftClose,
  Search,
  Settings2,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { initials } from "../lib/format";

const navigation = [
  { to: "/projects", label: "Projekte", icon: FolderKanban },
  { to: "/catalog", label: "Preiskatalog", icon: BookOpenText },
  { to: "/reports", label: "Berichte", icon: FileBarChart },
  { to: "/admin", label: "Administration", icon: Settings2, adminOnly: true },
];

function pageTitle(pathname: string): string {
  if (pathname.includes("/review")) return "Prüfung und Freigabe";
  if (/\/projects\/[^/]+\/versions\//.test(pathname)) return "Kostenermittlung";
  if (pathname === "/projects/new") return "Neues Projekt";
  if (pathname.startsWith("/catalog")) return "Preiskatalog";
  if (pathname.startsWith("/reports")) return "Berichte und Exporte";
  if (pathname.startsWith("/admin")) return "Administration";
  return "Projektübersicht";
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-monogram">IMV</div>
          <div className="brand-copy">
            <strong>Kostenmanager</strong>
            <span>Ril 808</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="Hauptnavigation">
          <p className="nav-eyebrow">Arbeitsbereich</p>
          {navigation
            .filter((item) => !item.adminOnly || user?.role === "admin")
            .map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </NavLink>
            ))}
          <p className="nav-eyebrow nav-eyebrow-spaced">Qualität</p>
          <div className="nav-static">
            <ClipboardCheck size={18} strokeWidth={1.8} />
            <span>Prüfregeln</span>
            <span className="nav-count">14</span>
          </div>
          <div className="nav-static muted">
            <Archive size={18} strokeWidth={1.8} />
            <span>Archiv</span>
          </div>
        </nav>

        <div className="sidebar-foot">
          <div className="catalog-state">
            <span className="state-dot" />
            <div>
              <strong>Katalog Q3 2026</strong>
              <small>Importiert und prüfbar</small>
            </div>
          </div>
          <button className="sidebar-collapse" type="button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? <Menu size={18} /> : <PanelLeftClose size={18} />}
            <span>Navigation einklappen</span>
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <p className="breadcrumb">IMV Kostenmanagement / Arbeitsbereich</p>
            <h1>{pageTitle(location.pathname)}</h1>
          </div>
          <div className="topbar-actions">
            <button className="global-search" type="button" onClick={() => navigate("/catalog")}>
              <Search size={17} />
              <span>Positionen durchsuchen</span>
              <kbd>⌘ K</kbd>
            </button>
            <div className="profile-wrap">
              <button className="profile-button" type="button" onClick={() => setProfileOpen((value) => !value)}>
                <span className="avatar">{initials(user?.name ?? "IMV")}</span>
                <span className="profile-copy">
                  <strong>{user?.name}</strong>
                  <small>{user?.role === "admin" ? "Administration" : "Kostenmanagement"}</small>
                </span>
                <ChevronDown size={15} />
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <div>
                    <strong>{user?.email}</strong>
                    <span>Rolle: {user?.role}</span>
                  </div>
                  <button type="button" onClick={() => void handleLogout()}>
                    <LogOut size={16} /> Abmelden
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
