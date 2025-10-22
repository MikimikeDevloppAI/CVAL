import { useState, useRef } from 'react';
import { Plus, Clipboard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TypesInterventionManagement, TypesInterventionManagementRef } from '@/components/blocOperatoire/TypesInterventionManagement';
import { ConfigurationsMultiFluxManagement } from '@/components/blocOperatoire/ConfigurationsMultiFluxManagement';
import { AddBesoinOperationDialog } from '@/components/operations/AddBesoinOperationDialog';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface OperationsPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OperationsPopup({ open, onOpenChange }: OperationsPopupProps) {
  const [activeView, setActiveView] = useState<'types' | 'flux'>('types');
  const [showBesoinDialog, setShowBesoinDialog] = useState(false);
  const typesManagementRef = useRef<TypesInterventionManagementRef>(null);
  const { canManage } = useCanManagePlanning();

  const handleClose = () => {
    setActiveView('types');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-4 pb-3 border-b border-border/50">
          <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent">
            Gestion des Opérations
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
          <div className="space-y-6">
            {/* Toggle between Types and Flux */}
            <div className="flex items-center justify-between">
              <div className="inline-flex gap-2 p-1 rounded-xl bg-background/50 backdrop-blur-sm border border-border/50 shadow-sm">
                <button
                  onClick={() => setActiveView('types')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeView === 'types'
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Types d'intervention
                </button>
                <button
                  onClick={() => setActiveView('flux')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeView === 'flux'
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Double / Triple Flux
                </button>
              </div>

              {/* Add buttons only for Types view */}
              {activeView === 'types' && canManage && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => setShowBesoinDialog(true)}
                    className="gap-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
                  >
                    <Clipboard className="h-4 w-4" />
                    Ajouter des besoins opération
                  </Button>
                  <Button
                    onClick={() => typesManagementRef.current?.openAddDialog()}
                    className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter une opération
                  </Button>
                </div>
              )}
            </div>

            {/* Content based on active view */}
            <div className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6 shadow-lg">
              {activeView === 'types' ? (
                <TypesInterventionManagement ref={typesManagementRef} />
              ) : (
                <ConfigurationsMultiFluxManagement />
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      <AddBesoinOperationDialog
        open={showBesoinDialog}
        onOpenChange={setShowBesoinDialog}
        onSuccess={() => {
          // Refresh data if needed
          setShowBesoinDialog(false);
        }}
      />
    </Dialog>
  );
}
