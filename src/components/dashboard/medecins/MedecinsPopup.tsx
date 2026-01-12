import { useState } from 'react';
import { Plus, Search, CalendarDays } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PrimaryButton, SecondaryButton } from '@/components/ui/primary-button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useMedecins, Medecin } from './useMedecins';
import { MedecinsList } from './MedecinsList';
import { MedecinFormDialog } from './MedecinFormDialog';
import { MedecinDetailDialog } from './MedecinDetailDialog';
import { MedecinCalendarDialog } from './MedecinCalendarDialog';
import { GlobalMedecinCalendarView } from '@/components/medecins/GlobalMedecinCalendarView';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface MedecinsPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  embedded?: boolean;
}

export function MedecinsPopup({ open, onOpenChange, embedded = false }: MedecinsPopupProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedMedecin, setSelectedMedecin] = useState<Medecin | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [globalCalendarOpen, setGlobalCalendarOpen] = useState(false);
  const [detailMedecin, setDetailMedecin] = useState<Medecin | null>(null);
  const [calendarMedecin, setCalendarMedecin] = useState<Medecin | null>(null);

  const { medecins, loading, fetchMedecins } = useMedecins();
  const { canManage } = useCanManagePlanning();

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

  const handleCloseDialog = () => {
    setShowForm(false);
    setSelectedMedecin(null);
    setSearchTerm('');
    setGlobalCalendarOpen(false);
    setDetailMedecin(null);
    setCalendarMedecin(null);
    onOpenChange(false);
  };

  const handleOpenDetail = (medecin: Medecin) => {
    setDetailMedecin(medecin);
  };

  const handleOpenCalendar = (medecin: Medecin) => {
    setCalendarMedecin(medecin);
  };

  const handleDetailUpdate = () => {
    fetchMedecins();
  };

  const content = (
    <div className={embedded ? "w-full" : "flex-1 overflow-y-auto px-6 pt-4 pb-6"}>
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
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Rechercher un médecin..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 rounded-xl border-border/50 bg-background/50 focus:bg-background transition-colors"
              />
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50">
                <Switch
                  checked={showInactive}
                  onCheckedChange={setShowInactive}
                  id="show-inactive-medecins-popup"
                  className="scale-90"
                />
                <label htmlFor="show-inactive-medecins-popup" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                  Inactifs
                </label>
              </div>

              {canManage && (
                <>
                  <SecondaryButton onClick={() => setGlobalCalendarOpen(true)}>
                    <CalendarDays className="h-4 w-4" />
                    <span className="hidden sm:inline">Calendrier Global</span>
                  </SecondaryButton>
                  <PrimaryButton onClick={handleAdd}>
                    <Plus className="h-4 w-4" />
                    <span className="hidden sm:inline">Ajouter</span>
                  </PrimaryButton>
                </>
              )}
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Chargement...</span>
              </div>
            </div>
          ) : (
            <MedecinsList
              medecins={medecins}
              searchTerm={searchTerm}
              showInactive={showInactive}
              onOpenDetail={handleOpenDetail}
              onOpenCalendar={handleOpenCalendar}
            />
          )}
        </div>
      )}
    </div>
  );

  if (embedded) {
    return (
      <>
        <div className="bg-card/50 backdrop-blur-xl border border-border/50 shadow-xl rounded-2xl p-6 h-[calc(100vh-48px)] flex flex-col">
          <h1 className="text-2xl font-bold mb-6 shrink-0">Gestion des Médecins</h1>

          {showForm ? (
            <div className="flex-1 overflow-y-auto">
              <MedecinFormDialog
                medecin={selectedMedecin}
                onSuccess={handleFormSuccess}
                onBack={handleBack}
              />
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Search and Actions - Fixed */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 mb-6 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher un médecin..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 h-11 rounded-xl border-border/50 bg-background/50 focus:bg-background transition-colors"
                  />
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50">
                    <Switch
                      checked={showInactive}
                      onCheckedChange={setShowInactive}
                      id="show-inactive-medecins-embedded"
                      className="scale-90"
                    />
                    <label htmlFor="show-inactive-medecins-embedded" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                      Inactifs
                    </label>
                  </div>

                  {canManage && (
                    <PrimaryButton onClick={handleAdd}>
                      <Plus className="h-4 w-4" />
                      <span className="hidden sm:inline">Ajouter</span>
                    </PrimaryButton>
                  )}
                </div>
              </div>

              {/* Scrollable List */}
              <div className="flex-1 overflow-y-auto overflow-x-visible min-h-0 -mx-2 px-2 pt-2 pb-2">
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm font-medium">Chargement...</span>
                    </div>
                  </div>
                ) : (
                  <MedecinsList
                    medecins={medecins}
                    searchTerm={searchTerm}
                    showInactive={showInactive}
                    onOpenDetail={handleOpenDetail}
                    onOpenCalendar={handleOpenCalendar}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Detail Dialog */}
        <MedecinDetailDialog
          medecin={detailMedecin}
          open={!!detailMedecin}
          onOpenChange={(open) => !open && setDetailMedecin(null)}
          onUpdate={handleDetailUpdate}
        />

        {/* Calendar Dialog */}
        {calendarMedecin && (
          <MedecinCalendarDialog
            open={!!calendarMedecin}
            onOpenChange={(open) => !open && setCalendarMedecin(null)}
            medecinId={calendarMedecin.id}
            medecinNom={`${calendarMedecin.first_name} ${calendarMedecin.name}`}
          />
        )}

        {/* Global Calendar Dialog */}
        <GlobalMedecinCalendarView
          open={globalCalendarOpen}
          onOpenChange={setGlobalCalendarOpen}
        />
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-4 pb-3 border-b border-border/50">
            <DialogTitle className="text-2xl font-bold">
              Gestion des Médecins
            </DialogTitle>
          </DialogHeader>

          {content}
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <MedecinDetailDialog
        medecin={detailMedecin}
        open={!!detailMedecin}
        onOpenChange={(open) => !open && setDetailMedecin(null)}
        onUpdate={handleDetailUpdate}
      />

      {/* Calendar Dialog */}
      {calendarMedecin && (
        <MedecinCalendarDialog
          open={!!calendarMedecin}
          onOpenChange={(open) => !open && setCalendarMedecin(null)}
          medecinId={calendarMedecin.id}
          medecinNom={`${calendarMedecin.first_name} ${calendarMedecin.name}`}
        />
      )}

      {/* Global Calendar Dialog */}
      <GlobalMedecinCalendarView
        open={globalCalendarOpen}
        onOpenChange={setGlobalCalendarOpen}
      />
    </>
  );
}
