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
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import BackupPage from "./pages/BackupPage";
import BlocOperatoirePage from "./pages/BlocOperatoirePage";
import StatistiquesPage from "./pages/StatistiquesPage";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import UsersPage from "./pages/UsersPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UpdatePasswordPage from "./pages/UpdatePasswordPage";
import SettingsPage from "./pages/SettingsPage";
import MedecinsPage from "./pages/MedecinsPage";
import AssistantsPage from "./pages/AssistantsPage";
import SitesPage from "./pages/SitesPage";
import OperationsPage from "./pages/OperationsPage";
import AbsencesPage from "./pages/AbsencesPage";
import CalendrierGlobalPage from "./pages/CalendrierGlobalPage";
import PlanifierPage from "./pages/PlanifierPage";
import GeneratePdfPage from "./pages/GeneratePdfPage";

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
                    <Route path="/" element={
                      <PlanningProtectedRoute>
                        <DashboardPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/home" element={<HomePage />} />
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
                    <Route path="/statistiques" element={
                      <PlanningProtectedRoute>
                        <StatistiquesPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/medecins" element={
                      <PlanningProtectedRoute>
                        <MedecinsPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/assistants" element={
                      <PlanningProtectedRoute>
                        <AssistantsPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/sites" element={
                      <PlanningProtectedRoute>
                        <SitesPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/operations" element={
                      <PlanningProtectedRoute>
                        <OperationsPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/absences" element={
                      <PlanningProtectedRoute>
                        <AbsencesPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/calendrier" element={
                      <PlanningProtectedRoute>
                        <CalendrierGlobalPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/planifier" element={
                      <PlanningProtectedRoute>
                        <PlanifierPage />
                      </PlanningProtectedRoute>
                    } />
                    <Route path="/generer-pdf" element={
                      <PlanningProtectedRoute>
                        <GeneratePdfPage />
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
