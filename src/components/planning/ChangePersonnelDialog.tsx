import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle, RefreshCw, UserPlus } from 'lucide-react';
import { canPerformBlocRole, getTypeBesoinLabel } from '@/lib/blocHelpers';

interface ChangePersonnelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: {
    id: string;
    type_besoin: string | null;
    secretaire_id: string | null;
    secretaire_nom?: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    operation_nom: string;
  };
  onSuccess: () => void;
}

interface PersonnelOption {
  id: string;
  first_name: string;
  name: string;
  instrumentaliste?: boolean;
  aide_de_salle?: boolean;
  anesthesiste?: boolean;
  bloc_dermato_accueil?: boolean;
  bloc_ophtalmo_accueil?: boolean;
}

interface SwapOption extends PersonnelOption {
  assignment_id: string;
  operation_nom: string;
}

export default function ChangePersonnelDialog({
  open,
  onOpenChange,
  assignment,
  onSuccess,
}: ChangePersonnelDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [availablePersonnel, setAvailablePersonnel] = useState<PersonnelOption[]>([]);
  const [swapPersonnel, setSwapPersonnel] = useState<SwapOption[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [action, setAction] = useState<'reassign' | 'swap'>('reassign');

  useEffect(() => {
    if (open) {
      setSelectedPersonId('');
      setAction('reassign');
      fetchPersonnel();
    }
  }, [open, assignment.id]);

  const fetchPersonnel = async () => {
    setLoading(true);
    try {
      // Récupérer tout le personnel du bloc avec compétences
      const { data: personnel, error: personnelError } = await supabase
        .from('secretaires')
        .select('id, first_name, name, instrumentaliste, aide_de_salle, anesthesiste, bloc_dermato_accueil, bloc_ophtalmo_accueil, personnel_bloc_operatoire')
        .eq('actif', true)
        .eq('personnel_bloc_operatoire', true);

      if (personnelError) throw personnelError;

      // Filtrer selon les compétences requises
      const eligible = (personnel || []).filter(p => 
        canPerformBlocRole(p, assignment.type_besoin)
      );

      // Récupérer les assignations existantes pour vérifier disponibilité
      const { data: assigned, error: assignedError } = await supabase
        .from('planning_genere_personnel')
        .select('secretaire_id')
        .eq('date', assignment.date)
        .eq('periode', assignment.periode)
        .not('secretaire_id', 'is', null);

      if (assignedError) throw assignedError;

      const assignedIds = new Set((assigned || []).map(a => a.secretaire_id));

      // Personnel disponible (non assigné)
      const available = eligible.filter(p => !assignedIds.has(p.id));
      setAvailablePersonnel(available);

      // Récupérer personnel échangeable (même type de besoin, autre opération)
      // Récupérer personnel échangeable seulement si type_besoin est défini
      let swappable: any[] = [];
      if (assignment.type_besoin) {
        const { data, error: swapError } = await supabase
          .from('planning_genere_personnel')
          .select(`
            id,
            secretaire_id,
            type_besoin_bloc,
            planning_genere_bloc_operatoire_id,
            secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey(
              id, first_name, name,
              instrumentaliste, aide_de_salle, anesthesiste,
              bloc_dermato_accueil, bloc_ophtalmo_accueil
            ),
            operation:planning_genere_bloc_operatoire!planning_genere_bloc_operatoire_id(
              type_intervention:types_intervention(nom)
            )
          `)
          .eq('date', assignment.date)
          .eq('periode', assignment.periode)
          .eq('type_assignation', 'bloc')
          .eq('type_besoin_bloc', assignment.type_besoin as any)
          .neq('id', assignment.id)
          .not('secretaire_id', 'is', null);

        if (swapError) throw swapError;
        swappable = data || [];
      }

      // Filtrer : vérifier que la personne actuelle peut faire le rôle
      const validSwaps = swappable
        .filter(s => s.secretaires)
        .map(s => ({
          ...s.secretaires,
          assignment_id: s.id,
          operation_nom: s.operation?.type_intervention?.nom || 'Opération inconnue',
        })) as SwapOption[];

      setSwapPersonnel(validSwaps);
    } catch (error) {
      console.error('Error fetching personnel:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger le personnel disponible',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedPersonId) {
      toast({
        title: 'Sélection requise',
        description: 'Veuillez sélectionner une personne',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      if (action === 'reassign') {
        // Réassignation simple
        const { error } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: selectedPersonId })
          .eq('id', assignment.id);

        if (error) throw error;

        toast({
          title: 'Succès',
          description: 'Le personnel a été réassigné avec succès',
        });
      } else {
        // Échange
        const targetAssignment = swapPersonnel.find(p => p.id === selectedPersonId);
        if (!targetAssignment) throw new Error('Assignation cible introuvable');

        // Échanger les secretaire_id
        const { error: error1 } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: targetAssignment.id })
          .eq('id', assignment.id);

        if (error1) throw error1;

        const { error: error2 } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: assignment.secretaire_id })
          .eq('id', targetAssignment.assignment_id);

        if (error2) throw error2;

        toast({
          title: 'Succès',
          description: 'L\'échange de personnel a été effectué avec succès',
        });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating personnel:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de modifier l\'assignation',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const personnelList = action === 'reassign' ? availablePersonnel : swapPersonnel;
  const noPersonnel = personnelList.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modifier l'assignation de personnel</DialogTitle>
          <DialogDescription>
            Opération : {assignment.operation_nom} - {assignment.date} ({assignment.periode === 'matin' ? 'Matin' : 'Après-midi'})
          </DialogDescription>
        </DialogHeader>

        {loading && personnelList.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Rôle requis</Label>
              <Badge variant="outline" className="text-sm">
                {getTypeBesoinLabel(assignment.type_besoin)}
              </Badge>
            </div>

            {assignment.secretaire_nom && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Personnel actuel</Label>
                <p className="text-sm text-muted-foreground">{assignment.secretaire_nom}</p>
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-sm font-medium">Action</Label>
              <RadioGroup value={action} onValueChange={(v) => setAction(v as 'reassign' | 'swap')}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="reassign" id="reassign" />
                  <Label htmlFor="reassign" className="flex items-center gap-2 cursor-pointer">
                    <UserPlus className="h-4 w-4" />
                    Réassigner à une personne disponible ({availablePersonnel.length})
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="swap" id="swap" />
                  <Label htmlFor="swap" className="flex items-center gap-2 cursor-pointer">
                    <RefreshCw className="h-4 w-4" />
                    Échanger avec une autre opération ({swapPersonnel.length})
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {noPersonnel ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {action === 'reassign'
                    ? 'Aucun personnel disponible avec les compétences requises pour ce rôle.'
                    : 'Aucune possibilité d\'échange trouvée pour ce rôle.'}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Sélectionner {action === 'reassign' ? 'une personne' : 'un échange'}
                </Label>
                <RadioGroup value={selectedPersonId} onValueChange={setSelectedPersonId}>
                  <div className="max-h-64 overflow-y-auto space-y-2 border rounded-md p-2">
                    {personnelList.map((person) => (
                      <div
                        key={person.id}
                        className="flex items-center space-x-2 p-2 hover:bg-muted/50 rounded-md"
                      >
                        <RadioGroupItem value={person.id} id={person.id} />
                        <Label
                          htmlFor={person.id}
                          className="flex-1 cursor-pointer flex items-center justify-between"
                        >
                          <span>
                            {person.first_name} {person.name}
                          </span>
                          {action === 'swap' && (
                            <span className="text-xs text-muted-foreground">
                              {(person as SwapOption).operation_nom}
                            </span>
                          )}
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading || noPersonnel || !selectedPersonId}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {action === 'reassign' ? 'Réassigner' : 'Échanger'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
