import { useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useMedecins, Medecin } from './useMedecins';
import { MedecinsList } from './MedecinsList';
import { MedecinFormDialog } from './MedecinFormDialog';
import { MedecinCalendarDialog } from './MedecinCalendarDialog';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface MedecinsPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MedecinsPopup({ open, onOpenChange }: MedecinsPopupProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedMedecin, setSelectedMedecin] = useState<Medecin | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [calendarMedecin, setCalendarMedecin] = useState<{ id: string; nom: string } | null>(null);
  
  const { medecins, loading, fetchMedecins, toggleStatus } = useMedecins();
  const { canManage } = useCanManagePlanning();

  const handleEdit = (medecin: Medecin) => {
    setSelectedMedecin(medecin);
    setShowForm(true);
  };

  const handleAdd = () => {
    setSelectedMedecin(null);
    setShowForm(true);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setSelectedMedecin(null);
    fetchMedecins();
  };

  const handleBack = () => {
    setShowForm(false);
    setSelectedMedecin(null);
  };

  const handleOpenCalendar = (medecin: { id: string; nom: string }) => {
    setCalendarMedecin(medecin);
  };

  const handleCloseDialog = () => {
    setShowForm(false);
    setSelectedMedecin(null);
    setSearchTerm('');
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-4 pb-3 border-b border-border/50">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-cyan-500 to-teal-600 bg-clip-text text-transparent">
              Gestion des Médecins
            </DialogTitle>
          </DialogHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {showForm ? (
              <MedecinFormDialog
                medecin={selectedMedecin}
                onSuccess={handleFormSuccess}
                onBack={handleBack}
              />
            ) : (
              <div className="space-y-6">
                {/* Search and Actions */}
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
                  <div className="relative flex-1 max-w-full md:max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600 dark:text-cyan-400" />
                    <Input
                      placeholder="Rechercher un médecin..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 border-cyan-200/50 focus:border-cyan-500"
                    />
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={showInactive}
                        onCheckedChange={setShowInactive}
                        id="show-inactive-medecins-popup"
                      />
                      <label htmlFor="show-inactive-medecins-popup" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                        Montrer inactifs
                      </label>
                    </div>

                    {canManage && (
                      <Button 
                        onClick={handleAdd}
                        className="gap-2 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600"
                      >
                        <Plus className="h-4 w-4" />
                        Ajouter un médecin
                      </Button>
                    )}
                  </div>
                </div>

                {/* List */}
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3 text-cyan-600 dark:text-cyan-400">
                      <div className="w-5 h-5 border-2 border-cyan-600 dark:border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm font-medium">Chargement...</span>
                    </div>
                  </div>
                ) : (
                  <MedecinsList
                    medecins={medecins}
                    searchTerm={searchTerm}
                    showInactive={showInactive}
                    onEdit={handleEdit}
                    onToggleStatus={toggleStatus}
                    onOpenCalendar={handleOpenCalendar}
                    canManage={canManage}
                  />
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Calendar Dialog */}
      {calendarMedecin && (
        <MedecinCalendarDialog
          open={!!calendarMedecin}
          onOpenChange={(open) => !open && setCalendarMedecin(null)}
          medecinId={calendarMedecin.id}
          medecinNom={calendarMedecin.nom}
        />
      )}
    </>
  );
}
