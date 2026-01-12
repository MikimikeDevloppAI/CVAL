import { useState, useRef } from 'react';
import { Plus, ListPlus, Scissors, Layers, Award } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PrimaryButton, SecondaryButton, TabButton } from '@/components/ui/primary-button';
import { TypesInterventionManagement, TypesInterventionManagementRef } from '@/components/blocOperatoire/TypesInterventionManagement';
import { ConfigurationsMultiFluxManagement } from '@/components/blocOperatoire/ConfigurationsMultiFluxManagement';
import { BesoinsOperationsManagement } from '@/components/blocOperatoire/BesoinsOperationsManagement';
import { AddBesoinOperationTypeDialog } from '@/components/operations/AddBesoinOperationTypeDialog';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface OperationsPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  embedded?: boolean;
}

export function OperationsPopup({ open, onOpenChange, embedded = false }: OperationsPopupProps) {
  const [activeView, setActiveView] = useState<'types' | 'flux' | 'competences'>('types');
  const [showBesoinTypeDialog, setShowBesoinTypeDialog] = useState(false);
  const typesManagementRef = useRef<TypesInterventionManagementRef>(null);
  const { canManage } = useCanManagePlanning();

  const handleClose = () => {
    setActiveView('types');
    onOpenChange(false);
  };

  const tabs = [
    { id: 'types' as const, label: "Types d'intervention", icon: Scissors },
    { id: 'flux' as const, label: 'Double / Triple Flux', icon: Layers },
    { id: 'competences' as const, label: 'Compétences opération', icon: Award },
  ];

  const content = (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tabs + Buttons */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 mb-6 shrink-0">
        <div className="flex gap-2 p-1 rounded-xl bg-muted/50 backdrop-blur-sm border border-border/30 flex-1 md:flex-initial">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabButton
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                active={activeView === tab.id}
                icon={<Icon className="h-4 w-4" />}
              >
                {tab.label}
              </TabButton>
            );
          })}
        </div>

        {/* Spacer to push buttons right */}
        <div className="flex-1 hidden md:block" />

        {/* Add buttons - Always on the right */}
        {activeView === 'types' && canManage && (
          <div className="flex gap-2 shrink-0">
            <SecondaryButton onClick={() => setShowBesoinTypeDialog(true)}>
              <ListPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Ajouter un type de besoin</span>
            </SecondaryButton>
            <PrimaryButton onClick={() => typesManagementRef.current?.openAddDialog()}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Ajouter un type d'opération</span>
            </PrimaryButton>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="bg-card/30 backdrop-blur-xl border border-border/30 rounded-xl p-5">
          {activeView === 'types' ? (
            <TypesInterventionManagement ref={typesManagementRef} />
          ) : activeView === 'flux' ? (
            <ConfigurationsMultiFluxManagement />
          ) : (
            <BesoinsOperationsManagement />
          )}
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <>
        <div className="bg-card/50 backdrop-blur-xl border border-border/50 shadow-xl rounded-2xl p-6 h-[calc(100vh-48px)] flex flex-col">
          <h1 className="text-2xl font-bold mb-6 shrink-0">Gestion des Opérations</h1>
          {content}
        </div>

        <AddBesoinOperationTypeDialog
          open={showBesoinTypeDialog}
          onOpenChange={setShowBesoinTypeDialog}
          onSuccess={() => setShowBesoinTypeDialog(false)}
        />
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-4 pb-3 border-b border-border/50">
            <DialogTitle className="text-2xl font-bold">Gestion des Opérations</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden px-6 pt-4 pb-6 flex flex-col">
            {content}
          </div>
        </DialogContent>
      </Dialog>

      <AddBesoinOperationTypeDialog
        open={showBesoinTypeDialog}
        onOpenChange={setShowBesoinTypeDialog}
        onSuccess={() => setShowBesoinTypeDialog(false)}
      />
    </>
  );
}
