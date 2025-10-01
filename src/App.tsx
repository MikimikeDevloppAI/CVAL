import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Layout } from "@/components/layout/Layout";
import PlanningPage from "./pages/PlanningPage";
import AbsencesPage from "./pages/AbsencesPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import MedecinsPage from "./pages/MedecinsPage";
import SecretairesPage from "./pages/SecretairesPage";
import SitesPage from "./pages/SitesPage";
import BackupPage from "./pages/BackupPage";
import BlocOperatoirePage from "./pages/BlocOperatoirePage";
import StatistiquesPage from "./pages/StatistiquesPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="*" element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/planning" element={<PlanningPage />} />
                    <Route path="/" element={<AbsencesPage />} />
                    <Route path="/medecins" element={<MedecinsPage />} />
                    <Route path="/secretaires" element={<SecretairesPage />} />
                    <Route path="/backup" element={<BackupPage />} />
                    <Route path="/bloc-operatoire" element={<BlocOperatoirePage />} />
                    <Route path="/sites" element={<SitesPage />} />
                    <Route path="/statistiques" element={<StatistiquesPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            } />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
