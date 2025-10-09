import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PlanningProtectedRoute } from "@/components/PlanningProtectedRoute";
import { AdminProtectedRoute } from "@/components/AdminProtectedRoute";
import { Layout } from "@/components/layout/Layout";
import PlanningPage from "./pages/PlanningPage";
import AbsencesPage from "./pages/AbsencesPage";
import JoursFeriesPage from "./pages/JoursFeriesPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import MedecinsPage from "./pages/MedecinsPage";
import SecretairesPage from "./pages/SecretairesPage";
import SitesPage from "./pages/SitesPage";
import BackupPage from "./pages/BackupPage";
import BlocOperatoirePage from "./pages/BlocOperatoirePage";
import StatistiquesPage from "./pages/StatistiquesPage";
import HomePage from "./pages/HomePage";
import UsersPage from "./pages/UsersPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";
import SettingsPage from "./pages/SettingsPage";

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
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/update-password" element={<UpdatePasswordPage />} />
            <Route path="*" element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/planning" element={<PlanningPage />} />
                    <Route path="/" element={<HomePage />} />
                    <Route path="/absences" element={
                      <PlanningProtectedRoute>
                        <AbsencesPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/jours-feries" element={
                      <PlanningProtectedRoute>
                        <JoursFeriesPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/medecins" element={
                      <PlanningProtectedRoute>
                        <MedecinsPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/secretaires" element={
                      <PlanningProtectedRoute>
                        <SecretairesPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/backup" element={
                      <PlanningProtectedRoute>
                        <BackupPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/bloc-operatoire" element={
                      <PlanningProtectedRoute>
                        <BlocOperatoirePage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/sites" element={
                      <PlanningProtectedRoute>
                        <SitesPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/statistiques" element={
                      <PlanningProtectedRoute>
                        <StatistiquesPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/users" element={
                      <AdminProtectedRoute>
                        <UsersPage />
                      </AdminProtectedRoute>
                    } />
                    <Route path="/settings" element={<SettingsPage />} />
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
