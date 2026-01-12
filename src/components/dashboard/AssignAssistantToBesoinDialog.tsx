import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, User, Search, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

interface Assistant {
  id: string;
  nom: string;
  prenom?: string;
  isAlreadyAssigned: boolean;
  currentAssignment?: string;
}

interface AssignAssistantToBesoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operationId: string;
  besoinOperationId: string;
  besoinOperationNom: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  siteId: string;
  siteName: string;
  onSuccess: () => void;
}

export function AssignAssistantToBesoinDialog({
  open,
  onOpenChange,
  operationId,
  besoinOperationId,
  besoinOperationNom,
  date,
  periode,
  siteId,
  siteName,
  onSuccess,
}: AssignAssistantToBesoinDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (open) {
      fetchAvailableAssistants();
    }
  }, [open, date, periode]);

  const fetchAvailableAssistants = async () => {
    setLoading(true);
    try {
      // Récupérer tous les assistants actifs
      const { data: allAssistants, error: assistantsError } = await supabase
        .from('secretaires')
        .select('id, nom, prenom')
        .eq('actif', true)
        .order('nom');

      if (assistantsError) throw assistantsError;

      // Récupérer les assignations existantes pour ce jour/période
      const { data: existingAssignments, error: assignmentsError } = await supabase
        .from('capacite_effective')
        .select(`
          secretaire_id,
          site_id,
          sites (nom)
        `)
        .eq('date', date)
        .eq('demi_journee', periode)
        .eq('actif', true);

      if (assignmentsError) throw assignmentsError;

      // Créer un map des assignations
      const assignmentMap = new Map<string, string>();
      existingAssignments?.forEach((a: any) => {
        assignmentMap.set(a.secretaire_id, a.sites?.nom || 'Autre site');
      });

      // Marquer les assistants comme déjà assignés ou non
      const processedAssistants: Assistant[] = (allAssistants || []).map(a => ({
        id: a.id,
        nom: a.nom,
        prenom: a.prenom || undefined,
        isAlreadyAssigned: assignmentMap.has(a.id),
        currentAssignment: assignmentMap.get(a.id),
      }));

      // Trier: non-assignés en premier, puis par nom
      processedAssistants.sort((a, b) => {
        if (a.isAlreadyAssigned !== b.isAlreadyAssigned) {
          return a.isAlreadyAssigned ? 1 : -1;
        }
        return a.nom.localeCompare(b.nom, 'fr');
      });

      setAssistants(processedAssistants);
    } catch (error) {
      console.error('Erreur lors du chargement des assistants:', error);
      toast.error('Impossible de charger les assistants');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (assistantId: string, assistantName: string) => {
    setSaving(true);
    try {
      // Créer l'assignation dans capacite_effective
      const { error } = await supabase
        .from('capacite_effective')
        .insert({
          date,
          secretaire_id: assistantId,
          site_id: siteId,
          demi_journee: periode,
          besoin_operation_id: besoinOperationId,
          planning_genere_bloc_operatoire_id: operationId,
          actif: true,
          is_1r: false,
          is_2f: false,
          is_3f: false,
        });

      if (error) throw error;

      toast.success(`${assistantName} assigné(e) comme ${besoinOperationNom}`);
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Erreur lors de l\'assignation:', error);

      // Vérifier si c'est une erreur de contrainte unique
      if (error.code === '23505') {
        toast.error('Cet assistant est déjà assigné à cette période');
      } else {
        toast.error('Impossible d\'assigner l\'assistant');
      }
    } finally {
      setSaving(false);
    }
  };

  // Filtrer les assistants par la recherche
  const filteredAssistants = assistants.filter(a => {
    const fullName = `${a.prenom || ''} ${a.nom}`.toLowerCase();
    return fullName.includes(searchQuery.toLowerCase());
  });

  const periodeLabel = periode === 'matin' ? 'Matin' : 'Après-midi';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-cyan-500" />
            Assigner un assistant
          </DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-foreground">{besoinOperationNom}</span>
            {' — '}
            {siteName} • {periodeLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* Barre de recherche */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un assistant..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
              {filteredAssistants.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Aucun assistant trouvé
                </div>
              ) : (
                filteredAssistants.map((assistant) => {
                  const fullName = `${assistant.prenom || ''} ${assistant.nom}`.trim();
                  const initials = `${(assistant.prenom || '').charAt(0)}${assistant.nom.charAt(0)}`.toUpperCase();

                  return (
                    <Button
                      key={assistant.id}
                      variant="outline"
                      className={cn(
                        "w-full justify-start gap-3 h-auto py-3",
                        assistant.isAlreadyAssigned
                          ? "opacity-60 hover:opacity-80"
                          : "hover:bg-cyan-50 hover:border-cyan-300 dark:hover:bg-cyan-950/30"
                      )}
                      onClick={() => handleAssign(assistant.id, fullName)}
                      disabled={saving}
                    >
                      <div className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg text-white text-sm font-bold",
                        assistant.isAlreadyAssigned
                          ? "bg-muted-foreground/50"
                          : "bg-gradient-to-br from-cyan-500 to-blue-600"
                      )}>
                        {initials}
                      </div>
                      <div className="flex-1 text-left">
                        <span className="font-medium block">{fullName}</span>
                        {assistant.isAlreadyAssigned && (
                          <span className="text-xs text-muted-foreground">
                            Déjà assigné(e) à {assistant.currentAssignment}
                          </span>
                        )}
                        {!assistant.isAlreadyAssigned && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Disponible
                          </span>
                        )}
                      </div>
                    </Button>
                  );
                })
              )}
            </div>
          )}

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Annuler
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
