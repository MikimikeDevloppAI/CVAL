import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Stethoscope } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface TypeIntervention {
  id: string;
  nom: string;
}

interface TypeInterventionSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinName: string;
  targetSiteName: string;
  onSelect: (typeInterventionId: string) => void;
}

export function TypeInterventionSelectionDialog({
  open,
  onOpenChange,
  medecinName,
  targetSiteName,
  onSelect,
}: TypeInterventionSelectionDialogProps) {
  const [loading, setLoading] = useState(true);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);

  useEffect(() => {
    if (open) {
      fetchTypesIntervention();
    }
  }, [open]);

  const fetchTypesIntervention = async () => {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('types_intervention')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      if (error) throw error;

      setTypesIntervention(data || []);
    } catch (err) {
      console.error('Erreur lors du chargement des types d\'intervention:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (typeId: string) => {
    onSelect(typeId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-teal-500" />
            Type d'intervention
          </DialogTitle>
          <DialogDescription>
            Sélectionnez le type d'intervention pour{' '}
            <span className="font-semibold text-foreground">{medecinName}</span>{' '}
            à <span className="font-semibold text-foreground">{targetSiteName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
              {typesIntervention.map((type) => (
                <Button
                  key={type.id}
                  variant="outline"
                  className={cn(
                    "w-full justify-start gap-3 h-12",
                    "hover:bg-teal-50 hover:border-teal-300 dark:hover:bg-teal-950/30"
                  )}
                  onClick={() => handleSelect(type.id)}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-900/50">
                    <Stethoscope className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  </div>
                  <span className="font-medium">{type.nom}</span>
                </Button>
              ))}
            </div>
          )}

          <Button
            variant="ghost"
            className="w-full mt-4"
            onClick={() => onOpenChange(false)}
          >
            Annuler
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
