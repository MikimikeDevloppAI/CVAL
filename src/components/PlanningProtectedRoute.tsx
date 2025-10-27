import { Navigate } from 'react-router-dom';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface PlanningProtectedRouteProps {
  children: React.ReactNode;
}

export const PlanningProtectedRoute = ({ children }: PlanningProtectedRouteProps) => {
  const { canManage, loading } = useCanManagePlanning();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!canManage) {
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
};
