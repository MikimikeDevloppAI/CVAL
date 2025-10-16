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
import { Loader2, AlertCircle, RefreshCw, UserPlus, User, Trash2 } from 'lucide-react';
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
    planning_genere_bloc_operatoire_id: string;
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
  type_besoin: string | null;
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
  const [sameOpPersonnel, setSameOpPersonnel] = useState<SwapOption[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [action, setAction] = useState<'reassign' | 'swap_other_operation' | 'swap_same_operation' | 'remove'>('reassign');

  useEffect(() => {
    if (open) {
      setSelectedPersonId('');
      setAction('reassign');
      fetchPersonnel();
    }
  }, [open, assignment.id]);

  const fetchPersonnel = async () => {
    if (!open || !assignment.type_besoin) return;
    
    setLoading(true);
    try {
      // 1. Récupérer tous les secrétaires avec leurs compétences bloc
      const { data: allSecretaires, error: secError } = await supabase
        .from('secretaires')
        .select('id, first_name, name, instrumentaliste, aide_de_salle, anesthesiste, bloc_dermato_accueil, bloc_ophtalmo_accueil, personnel_bloc_operatoire')
        .eq('actif', true)
        .eq('personnel_bloc_operatoire', true);

      if (secError) throw secError;

      // Filtrer selon les compétences requises
      const eligible = (allSecretaires || []).filter(sec => 
        canPerformBlocRole(sec, assignment.type_besoin)
      );

      // 2. Récupérer toutes les assignations du même jour/période
      const { data: assigned, error: assignError } = await supabase
        .from('planning_genere_personnel')
        .select('secretaire_id')
        .eq('date', assignment.date)
        .eq('periode', assignment.periode)
        .eq('type_assignation', 'bloc')
        .not('secretaire_id', 'is', null);

      if (assignError) throw assignError;

      const assignedIds = new Set((assigned || []).map(a => a.secretaire_id));
      
      // Personnel disponible = compétent ET non assigné
      const available = eligible.filter(p => !assignedIds.has(p.id));
      setAvailablePersonnel(available);

      // 3. Récupérer le personnel de la même opération (rôles différents)
      if (assignment.secretaire_id) {
        const { data: sameOp, error: sameOpError } = await supabase
          .from('planning_genere_personnel')
          .select(`
            id,
            secretaire_id,
            type_besoin_bloc,
            secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey(
              id, first_name, name,
              instrumentaliste, aide_de_salle, anesthesiste,
              bloc_dermato_accueil, bloc_ophtalmo_accueil
            )
          `)
          .eq('planning_genere_bloc_operatoire_id', assignment.planning_genere_bloc_operatoire_id)
          .eq('type_assignation', 'bloc')
          .neq('id', assignment.id)
          .neq('type_besoin_bloc', assignment.type_besoin as any)
          .not('secretaire_id', 'is', null);

        if (sameOpError) throw sameOpError;

        // Récupérer les compétences de la personne actuelle
        const { data: currentSecretaire } = await supabase
          .from('secretaires')
          .select('instrumentaliste, aide_de_salle, anesthesiste, bloc_dermato_accueil, bloc_ophtalmo_accueil')
          .eq('id', assignment.secretaire_id)
          .single();

        // Vérification bidirectionnelle : les deux peuvent faire le rôle de l'autre
        const validSameOp = (sameOp || [])
          .filter(s => {
            if (!s.secretaires || !currentSecretaire || !assignment.type_besoin || !s.type_besoin_bloc) return false;
            
            // La personne cible peut-elle faire le rôle actuel ?
            const targetCanDoCurrentRole = canPerformBlocRole(s.secretaires, assignment.type_besoin);
            
            // La personne actuelle peut-elle faire le rôle cible ?
            const currentCanDoTargetRole = canPerformBlocRole(currentSecretaire, s.type_besoin_bloc);
            
            return targetCanDoCurrentRole && currentCanDoTargetRole;
          })
          .map(s => ({
            ...s.secretaires!,
            assignment_id: s.id,
            type_besoin: s.type_besoin_bloc,
            operation_nom: assignment.operation_nom
          }));

        setSameOpPersonnel(validSameOp);

        // 4. Récupérer le personnel échangeable (autres opérations, même type de besoin)
        const { data: swappable, error: swapError } = await supabase
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
            operation:planning_genere_bloc_operatoire_id(
              type_intervention:type_intervention_id(nom)
            )
          `)
          .eq('date', assignment.date)
          .eq('periode', assignment.periode)
          .eq('type_assignation', 'bloc')
          .eq('type_besoin_bloc', assignment.type_besoin as any)
          .neq('planning_genere_bloc_operatoire_id', assignment.planning_genere_bloc_operatoire_id)
          .neq('id', assignment.id)
          .not('secretaire_id', 'is', null);

        if (swapError) throw swapError;

        const validSwaps = (swappable || [])
          .filter(s => s.secretaires && assignment.type_besoin && canPerformBlocRole(s.secretaires, assignment.type_besoin))
          .map(s => ({
            ...s.secretaires!,
            assignment_id: s.id,
            type_besoin: s.type_besoin_bloc,
            operation_nom: s.operation?.type_intervention?.nom || 'Opération'
          }));

        setSwapPersonnel(validSwaps);
      }
    } catch (error) {
      console.error('Erreur lors du chargement du personnel:', error);
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
    if (action !== 'remove' && !selectedPersonId) {
      toast({
        title: 'Attention',
        description: 'Veuillez sélectionner un personnel',
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
          description: assignment.secretaire_id ? 'Personnel réassigné avec succès' : 'Personnel assigné avec succès',
        });
      } else if (action === 'swap_same_operation') {
        // Échange dans la même opération
        const targetPerson = sameOpPersonnel.find(p => p.id === selectedPersonId);
        if (!targetPerson) throw new Error('Personnel cible introuvable');

        // Échanger les deux assignations
        const { error: error1 } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: targetPerson.id })
          .eq('id', assignment.id);

        if (error1) throw error1;

        const { error: error2 } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: assignment.secretaire_id })
          .eq('id', targetPerson.assignment_id);

        if (error2) throw error2;

        toast({
          title: 'Succès',
          description: 'Échange effectué dans la même opération',
        });
      } else if (action === 'swap_other_operation') {
        // Échange avec une autre opération
        const targetPerson = swapPersonnel.find(p => p.id === selectedPersonId);
        if (!targetPerson) throw new Error('Personnel cible introuvable');

        // Échanger les deux assignations
        const { error: error1 } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: targetPerson.id })
          .eq('id', assignment.id);

        if (error1) throw error1;

        const { error: error2 } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: assignment.secretaire_id })
          .eq('id', targetPerson.assignment_id);

        if (error2) throw error2;

        toast({
          title: 'Succès',
          description: 'Échange effectué avec une autre opération',
        });
      } else if (action === 'remove') {
        // Retirer le personnel
        const { error } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: null })
          .eq('id', assignment.id);

        if (error) throw error;

        toast({
          title: 'Succès',
          description: 'Personnel retiré du poste',
        });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Erreur lors de la modification:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de modifier le personnel',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier l'assignation de personnel</DialogTitle>
          <DialogDescription>
            Opération : {assignment.operation_nom} - {assignment.date} ({assignment.periode === 'matin' ? 'Matin' : 'Après-midi'})
          </DialogDescription>
        </DialogHeader>

        {loading && availablePersonnel.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span>Rôle requis: <strong>{getTypeBesoinLabel(assignment.type_besoin)}</strong></span>
            </div>

            {assignment.secretaire_nom && (
              <div className="flex items-center gap-2 text-sm">
                <span>Actuellement assigné: <strong>{assignment.secretaire_nom}</strong></span>
              </div>
            )}

            {!assignment.secretaire_id ? (
              // Poste vide : uniquement assignation
              <>
                <RadioGroup value={action} onValueChange={(value) => setAction(value as any)}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="reassign" id="reassign" />
                    <Label htmlFor="reassign" className="flex items-center gap-2 cursor-pointer">
                      <UserPlus className="h-4 w-4" />
                      Assigner une personne disponible ({availablePersonnel.length})
                    </Label>
                  </div>
                </RadioGroup>

                {availablePersonnel.length === 0 ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Aucun personnel disponible avec les compétences requises pour ce rôle.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    <Label>Sélectionner un personnel disponible</Label>
                    <RadioGroup value={selectedPersonId} onValueChange={setSelectedPersonId}>
                      {availablePersonnel.map(person => (
                        <div key={person.id} className="flex items-center space-x-2">
                          <RadioGroupItem value={person.id} id={person.id} />
                          <Label htmlFor={person.id} className="cursor-pointer flex-1">
                            {person.first_name} {person.name}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </>
            ) : (
              // Poste occupé : toutes les options
              <>
                <RadioGroup value={action} onValueChange={(value) => setAction(value as any)}>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="reassign" id="reassign" />
                      <Label htmlFor="reassign" className="flex items-center gap-2 cursor-pointer">
                        <UserPlus className="h-4 w-4" />
                        Réassigner à une personne disponible ({availablePersonnel.length})
                      </Label>
                    </div>

                    {sameOpPersonnel.length > 0 && (
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="swap_same_operation" id="swap_same_operation" />
                        <Label htmlFor="swap_same_operation" className="flex items-center gap-2 cursor-pointer">
                          <RefreshCw className="h-4 w-4" />
                          Échanger dans la même opération ({sameOpPersonnel.length})
                        </Label>
                      </div>
                    )}

                    {swapPersonnel.length > 0 && (
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="swap_other_operation" id="swap_other_operation" />
                        <Label htmlFor="swap_other_operation" className="flex items-center gap-2 cursor-pointer">
                          <RefreshCw className="h-4 w-4" />
                          Échanger avec une autre opération ({swapPersonnel.length})
                        </Label>
                      </div>
                    )}

                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="remove" id="remove" />
                      <Label htmlFor="remove" className="flex items-center gap-2 cursor-pointer text-destructive">
                        <Trash2 className="h-4 w-4" />
                        Retirer du poste
                      </Label>
                    </div>
                  </div>
                </RadioGroup>

                {action === 'reassign' && (
                  <>
                    {availablePersonnel.length === 0 ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          Aucun personnel disponible avec les compétences requises pour ce rôle.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-2">
                        <Label>Sélectionner un personnel disponible</Label>
                        <RadioGroup value={selectedPersonId} onValueChange={setSelectedPersonId}>
                          {availablePersonnel.map(person => (
                            <div key={person.id} className="flex items-center space-x-2">
                              <RadioGroupItem value={person.id} id={person.id} />
                              <Label htmlFor={person.id} className="cursor-pointer flex-1">
                                {person.first_name} {person.name}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </>
                )}

                {action === 'swap_same_operation' && (
                  <div className="space-y-2">
                    <Label>Sélectionner un personnel de la même opération à échanger</Label>
                    <RadioGroup value={selectedPersonId} onValueChange={setSelectedPersonId}>
                      {sameOpPersonnel.map(person => (
                        <div key={person.id} className="flex items-center space-x-2">
                          <RadioGroupItem value={person.id} id={person.id} />
                          <Label htmlFor={person.id} className="cursor-pointer flex-1">
                            <div>
                              <div>{person.first_name} {person.name}</div>
                              <div className="text-xs text-muted-foreground">
                                Rôle actuel: {getTypeBesoinLabel(person.type_besoin)}
                              </div>
                            </div>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}

                {action === 'swap_other_operation' && (
                  <>
                    {swapPersonnel.length === 0 ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          Aucun échange possible avec d'autres opérations pour ce rôle.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-2">
                        <Label>Sélectionner un personnel d'une autre opération à échanger</Label>
                        <RadioGroup value={selectedPersonId} onValueChange={setSelectedPersonId}>
                          {swapPersonnel.map(person => (
                            <div key={person.id} className="flex items-center space-x-2">
                              <RadioGroupItem value={person.id} id={person.id} />
                              <Label htmlFor={person.id} className="cursor-pointer flex-1">
                                <div>
                                  <div>{person.first_name} {person.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {person.operation_nom}
                                  </div>
                                </div>
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </>
                )}

                {action === 'remove' && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Le poste sera libéré et aucun personnel ne sera assigné.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading || (action !== 'remove' && !selectedPersonId)}
            variant={action === 'remove' ? 'destructive' : 'default'}
          >
            {loading ? 'Chargement...' : 
              action === 'reassign' ? (assignment.secretaire_id ? 'Réassigner' : 'Assigner') :
              action === 'swap_same_operation' ? 'Échanger' :
              action === 'swap_other_operation' ? 'Échanger' :
              'Retirer'
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
