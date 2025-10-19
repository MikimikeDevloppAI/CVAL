import { useState } from 'react';
import { Plus, Search, CalendarDays } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useSecretaires, Secretaire } from './useSecretaires';
import { SecretairesList } from './SecretairesList';
import { SecretaireFormDialog } from './SecretaireFormDialog';
import { SecretaireCalendarDialog } from './SecretaireCalendarDialog';
import { GlobalCalendarView } from '@/components/secretaires/GlobalCalendarView';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface SecretairesPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SecretairesPopup({ open, onOpenChange }: SecretairesPopupProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedSecretaire, setSelectedSecretaire] = useState<Secretaire | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [calendarSecretaire, setCalendarSecretaire] = useState<{ id: string; nom: string } | null>(null);
  const [globalCalendarOpen, setGlobalCalendarOpen] = useState(false);
  
  const { secretaires, loading, fetchSecretaires, toggleStatus } = useSecretaires();
  const { canManage } = useCanManagePlanning();

  const handleEdit = (secretaire: Secretaire) => {
    setSelectedSecretaire(secretaire);
    setShowForm(true);
  };

  const handleAdd = () => {
    setSelectedSecretaire(null);
    setShowForm(true);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setSelectedSecretaire(null);
    fetchSecretaires();
  };

  const handleBack = () => {
    setShowForm(false);
    setSelectedSecretaire(null);
  };

  const handleOpenCalendar = (secretaire: { id: string; nom: string }) => {
    setCalendarSecretaire(secretaire);
  };

  const handleCloseDialog = () => {
    setShowForm(false);
    setSelectedSecretaire(null);
    setSearchTerm('');
    setGlobalCalendarOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-4 pb-3 border-b border-border/50">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-teal-500 to-cyan-600 bg-clip-text text-transparent">
              Gestion des Assistants Médicaux
            </DialogTitle>
          </DialogHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
            {showForm ? (
              <SecretaireFormDialog
                secretaire={selectedSecretaire}
                onSuccess={handleFormSuccess}
                onBack={handleBack}
              />
            ) : (
              <div className="space-y-6">
                {/* Search and Actions */}
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-600 dark:text-teal-400" />
                    <Input
                      placeholder="Rechercher un assistant médical..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 border-teal-200/50 focus:border-teal-500"
                    />
                  </div>
                  
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={showInactive}
                        onCheckedChange={setShowInactive}
                        id="show-inactive-secretaires-popup"
                      />
                      <label htmlFor="show-inactive-secretaires-popup" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                        Montrer inactifs
                      </label>
                    </div>

                    {canManage && (
                      <>
                        <Button 
                          variant="outline" 
                          onClick={() => setGlobalCalendarOpen(true)}
                          className="gap-2 border-teal-200/50 hover:bg-teal-50 dark:hover:bg-teal-950/20"
                        >
                          <CalendarDays className="h-4 w-4" />
                          Calendrier Global
                        </Button>
                        <Button 
                          onClick={handleAdd}
                          className="gap-2 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600"
                        >
                          <Plus className="h-4 w-4" />
                          Ajouter un assistant
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* List */}
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3 text-teal-600 dark:text-teal-400">
                      <div className="w-5 h-5 border-2 border-teal-600 dark:border-teal-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm font-medium">Chargement...</span>
                    </div>
                  </div>
                ) : (
                  <SecretairesList
                    secretaires={secretaires}
                    searchTerm={searchTerm}
                    showInactive={showInactive}
                    onEdit={handleEdit}
                    onToggleStatus={toggleStatus}
                    onOpenCalendar={handleOpenCalendar}
                    onSuccess={fetchSecretaires}
                    canManage={canManage}
                  />
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Calendar Dialog */}
      {calendarSecretaire && (
        <SecretaireCalendarDialog
          open={!!calendarSecretaire}
          onOpenChange={(open) => !open && setCalendarSecretaire(null)}
          secretaireId={calendarSecretaire.id}
          secretaireNom={calendarSecretaire.nom}
        />
      )}

      {/* Global Calendar Dialog */}
      <GlobalCalendarView 
        open={globalCalendarOpen} 
        onOpenChange={setGlobalCalendarOpen}
      />
    </>
  );
}
