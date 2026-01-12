import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useSecretaires, Secretaire } from './useSecretaires';
import { SecretairesList } from './SecretairesList';
import { SecretaireFormCard } from './SecretaireFormCard';
import { SecretaireDetailDialog } from './SecretaireDetailDialog';
import { SecretaireCalendarDialog } from './SecretaireCalendarDialog';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface SecretairesPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  embedded?: boolean;
}

export function SecretairesPopup({ open, onOpenChange, embedded = false }: SecretairesPopupProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedSecretaire, setSelectedSecretaire] = useState<Secretaire | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [calendarSecretaire, setCalendarSecretaire] = useState<{ id: string; nom: string } | null>(null);
  const [detailSecretaire, setDetailSecretaire] = useState<Secretaire | null>(null);

  const { secretaires, loading, fetchSecretaires } = useSecretaires();
  const { canManage } = useCanManagePlanning();

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

  const handleOpenDetail = (secretaire: Secretaire) => {
    setDetailSecretaire(secretaire);
  };

  const handleOpenCalendar = (secretaire: { id: string; nom: string }) => {
    setCalendarSecretaire(secretaire);
  };

  const handleDetailUpdate = () => {
    fetchSecretaires();
  };

  const handleCloseDialog = () => {
    setShowForm(false);
    setSelectedSecretaire(null);
    setSearchTerm('');
    setDetailSecretaire(null);
    setCalendarSecretaire(null);
    onOpenChange(false);
  };

  const content = (
    <div className={embedded ? "w-full" : "flex-1 overflow-y-auto px-6 pt-4 pb-6"}>
      {showForm ? (
        <SecretaireFormCard
          secretaire={selectedSecretaire}
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
                placeholder="Rechercher un assistant médical..."
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
                  id="show-inactive-secretaires-popup"
                  className="scale-90"
                />
                <label htmlFor="show-inactive-secretaires-popup" className="text-sm font-medium cursor-pointer whitespace-nowrap">
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

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Chargement...</span>
              </div>
            </div>
          ) : (
            <SecretairesList
              secretaires={secretaires}
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
          <h1 className="text-2xl font-bold mb-6 shrink-0">Gestion des Assistants Médicaux</h1>

          {showForm ? (
            <div className="flex-1 overflow-y-auto">
              <SecretaireFormCard
                secretaire={selectedSecretaire}
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
                    placeholder="Rechercher un assistant médical..."
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
                      id="show-inactive-secretaires-embedded"
                      className="scale-90"
                    />
                    <label htmlFor="show-inactive-secretaires-embedded" className="text-sm font-medium cursor-pointer whitespace-nowrap">
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
                  <SecretairesList
                    secretaires={secretaires}
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
        <SecretaireDetailDialog
          secretaire={detailSecretaire}
          open={!!detailSecretaire}
          onOpenChange={(open) => !open && setDetailSecretaire(null)}
          onUpdate={handleDetailUpdate}
        />

        {/* Calendar Dialog */}
        {calendarSecretaire && (
          <SecretaireCalendarDialog
            open={!!calendarSecretaire}
            onOpenChange={(open) => !open && setCalendarSecretaire(null)}
            secretaireId={calendarSecretaire.id}
            secretaireNom={calendarSecretaire.nom}
          />
        )}
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
              Gestion des Assistants Médicaux
            </DialogTitle>
          </DialogHeader>

          {content}
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <SecretaireDetailDialog
        secretaire={detailSecretaire}
        open={!!detailSecretaire}
        onOpenChange={(open) => !open && setDetailSecretaire(null)}
        onUpdate={handleDetailUpdate}
      />

      {/* Calendar Dialog */}
      {calendarSecretaire && (
        <SecretaireCalendarDialog
          open={!!calendarSecretaire}
          onOpenChange={(open) => !open && setCalendarSecretaire(null)}
          secretaireId={calendarSecretaire.id}
          secretaireNom={calendarSecretaire.nom}
        />
      )}
    </>
  );
}
