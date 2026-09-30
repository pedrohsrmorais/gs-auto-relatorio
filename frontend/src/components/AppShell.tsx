import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  Briefcase, Users, ListChecks, Bell, ChevronDown, LogOut, Menu, X, Building2, Tags,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
}

const MAIN_NAV: NavItem[] = [
  { label: "Jobs", to: "/jobs", icon: <Briefcase className="h-4 w-4" /> },
  { label: "Clientes", to: "/clientes", icon: <Building2 className="h-4 w-4" /> },
];

const ADMIN_NAV: NavItem[] = [
  { label: "Usuários", to: "/admin/usuarios", icon: <Users className="h-4 w-4" /> },
  { label: "Pontos", to: "/admin/pontos", icon: <Tags className="h-4 w-4" /> },
];

export function Avatar({ initials, size = 40 }: { initials: string; size?: number }) {
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground grid place-items-center font-display font-semibold shrink-0 select-none"
    >
      {initials}
    </div>
  );
}

function NavLink({ item, onClick, isActive }: { item: NavItem; onClick: () => void; isActive: boolean }) {
  return (
    <Link
      to={item.to}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive ? "bg-primary/15 text-primary" : "text-foreground/70 hover:bg-muted hover:text-foreground"
      }`}
    >
      <span className={isActive ? "text-primary" : "text-muted-foreground"}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  function isActive(to: string) {
    return pathname.startsWith(to);
  }

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border flex flex-col
        transform transition-transform duration-200 ease-in-out
        lg:relative lg:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <Link to="/jobs" className="flex items-center gap-2.5" onClick={() => setSidebarOpen(false)}>
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="text-primary-foreground font-bold text-sm">S</span>
            </div>
            <span className="font-display font-semibold text-lg tracking-tight">Grupo Studio</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {user && (
          <div className="px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <Avatar initials={user.initials ?? "U"} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-5">
          <div>
            <ul className="space-y-0.5">
              {MAIN_NAV.map((item) => (
                <li key={item.to}>
                  <NavLink item={item} isActive={isActive(item.to)} onClick={() => setSidebarOpen(false)} />
                </li>
              ))}
            </ul>
          </div>

          {user?.role === "admin" && (
            <div>
              <p className="px-2 mb-2 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                Administração
              </p>
              <ul className="space-y-0.5">
                {ADMIN_NAV.map((item) => (
                  <li key={item.to}>
                    <NavLink item={item} isActive={isActive(item.to)} onClick={() => setSidebarOpen(false)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>

        <div className="border-t border-border py-3 px-3 shrink-0">
          <button
            onClick={() => { logout(); setSidebarOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
            Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-border bg-card flex items-center gap-3 px-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-muted-foreground hover:text-foreground transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <button className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <Bell className="h-4 w-4" />
            </button>

            {user && (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 h-9 px-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <Avatar initials={user.initials ?? "U"} size={28} />
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>

                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-card border border-border rounded-lg shadow-lg py-1 text-sm">
                      <div className="px-3 py-2 border-b border-border">
                        <p className="font-medium truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                      <button
                        onClick={() => { logout(); setUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted transition-colors text-destructive/80 hover:text-destructive"
                      >
                        <LogOut className="h-4 w-4" /> Sair
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}