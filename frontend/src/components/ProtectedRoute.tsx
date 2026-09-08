import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export function ProtectedRoute({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    if (requireAdmin && user.role !== "admin") {
      navigate({ to: "/jobs" });
    }
  }, [user, loading, requireAdmin, navigate]);

  if (loading || !user || (requireAdmin && user.role !== "admin")) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return <>{children}</>;
}
