import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, Users, MapPin, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ChangeSalleDialog } from '@/components/planning/ChangeSalleDialog';
import { AssignPersonnelDialog } from './AssignPersonnelDialog';
import { ReassignOperationDialog } from './ReassignOperationDialog';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Operation {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  salle_assignee: string | null;
  besoin_effectif_id?: string | null;
  salles_operation: {
    id: string;
    name: string;
  } | null;
  medecins: {
    id: string;
    first_name: string;
    name: string;
  } | null;
  types_intervention: {
    id: string;
    nom: string;
    code: string;
  };
}

interface Besoin {
  nombre_requis: number;
  besoins_operations: {
    id: string;
    nom: string;
    code: string;
  };
}

interface Assignment {
  id: string;
  besoin_operation_id: string;
  secretaires: {
    id: string;
    first_name: string;
    name: string;
  };
}

interface OperationCardProps {
  operation: Operation;
  onUpdate: () => void;
}

export const OperationCard = ({ operation, onUpdate }: OperationCardProps) => {
  const [besoins, setBesoins] = useState<Besoin[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [changeSalleOpen, setChangeSalleOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedBesoin, setSelectedBesoin] = useState<{ id: string; nom: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [besoinEffectifId, setBesoinEffectifId] = useState<string | null>(null);

  useEffect(() => {
    fetchBesoins();
    fetchAssignments();
    fetchBesoinEffectifId();
  }, [operation.id]);

  const fetchBesoinEffectifId = async () => {
    const { data, error } = await supabase
      .from('planning_genere_bloc_operatoire')
      .select('besoin_effectif_id')
      .eq('id', operation.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching besoin_effectif_id:', error);
      return;
    }
    setBesoinEffectifId(data?.besoin_effectif_id || null);
  };

  const fetchBesoins = async () => {
    const { data, error } = await supabase
      .from('types_intervention_besoins_personnel')
      .select(`
        nombre_requis,
        besoins_operations (
          id,
          nom,
          code
        )
      `)
      .eq('type_intervention_id', operation.types_intervention.id)
      .eq('actif', true);

    if (error) {
      console.error('Error fetching besoins:', error);
      return;
    }
    setBesoins(data || []);
  };

  const fetchAssignments = async () => {
    const { data, error } = await supabase
      .from('capacite_effective')
      .select(`
        id,
        besoin_operation_id,
        secretaires (
          id,
          first_name,
          name
        )
      `)
      .eq('planning_genere_bloc_operatoire_id', operation.id)
      .eq('date', operation.date)
      .eq('demi_journee', operation.periode);

    if (error) {
      console.error('Error fetching assignments:', error);
      return;
    }
    setAssignments(data || []);
  };

  const getSalleColor = (salleName: string | null) => {
    if (!salleName) return 'bg-muted text-muted-foreground border-muted';
    
    const name = salleName.toLowerCase();
    if (name.includes('rouge')) return 'bg-red-100 text-red-700 border-red-300';
    if (name.includes('vert')) return 'bg-green-100 text-green-700 border-green-300';
    if (name.includes('jaune')) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    return 'bg-muted text-muted-foreground border-muted';
  };

  const getAssignedForBesoin = (besoinId: string) => {
    return assignments.filter(a => a.besoin_operation_id === besoinId);
  };

  const handleRemoveAssignment = async (assignmentId: string) => {
    try {
      const { error } = await supabase
        .from('capacite_effective')
        .update({
          planning_genere_bloc_operatoire_id: null,
          besoin_operation_id: null
        })
        .eq('id', assignmentId);

      if (error) throw error;
      
      toast.success('Personnel retiré');
      fetchAssignments();
      onUpdate();
    } catch (error) {
      console.error('Error removing assignment:', error);
      toast.error('Erreur lors du retrait du personnel');
    }
  };

  const handleOpenAssignDialog = (besoinId: string, besoinNom: string) => {
    setSelectedBesoin({ id: besoinId, nom: besoinNom });
    setAssignDialogOpen(true);
  };

  const handleDeleteCompletely = async () => {
    try {
      // Réinitialiser les capacites_effective liées à cette opération
      const { error: capaciteError } = await supabase
        .from('capacite_effective')
        .update({
          planning_genere_bloc_operatoire_id: null,
          besoin_operation_id: null,
          site_id: '00000000-0000-0000-0000-000000000001'
        })
        .eq('planning_genere_bloc_operatoire_id', operation.id);

      if (capaciteError) throw capaciteError;

      // Supprimer le planning_genere_bloc_operatoire
      const { error: planningError } = await supabase
        .from('planning_genere_bloc_operatoire')
        .delete()
        .eq('id', operation.id);

      if (planningError) throw planningError;

      // Supprimer le besoin_effectif si présent
      if (besoinEffectifId) {
        const { error: besoinError } = await supabase
          .from('besoin_effectif')
          .delete()
          .eq('id', besoinEffectifId);

        if (besoinError) throw besoinError;
      }

      toast.success('Opération supprimée définitivement');
      setDeleteDialogOpen(false);
      onUpdate();
    } catch (error) {
      console.error('Error deleting operation:', error);
      toast.error('Erreur lors de la suppression de l\'opération');
    }
  };

  const handleReassignSuccess = () => {
    setDeleteDialogOpen(false);
    onUpdate();
  };

  return (
    <>
      <div className="rounded-lg border border-border p-3 space-y-3 bg-transparent hover:shadow-md transition-shadow">
        {/* Period, Room and Delete */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {operation.periode === 'matin' ? 'Matin' : 'Après-midi'}
          </span>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "cursor-pointer hover:opacity-80 transition-opacity font-medium text-xs",
                getSalleColor(operation.salles_operation?.name || null)
              )}
              onClick={() => setChangeSalleOpen(true)}
            >
              <MapPin className="h-3 w-3 mr-1" />
              {operation.salles_operation?.name || 'Non assignée'}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Doctor */}
        <div className="flex items-center gap-2 text-sm">
          <Stethoscope className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">
            Dr. {operation.medecins?.first_name} {operation.medecins?.name}
          </span>
        </div>

        {/* Intervention Type */}
        <div className="text-sm text-muted-foreground">
          {operation.types_intervention.nom}
        </div>

        {/* Personnel Requirements */}
        <div className="space-y-2 pt-2 border-t border-border/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            <span>Personnel requis:</span>
          </div>
          
          {besoins.map((besoin) => {
            const assigned = getAssignedForBesoin(besoin.besoins_operations.id);
            const required = besoin.nombre_requis;
            
            return (
              <div key={besoin.besoins_operations.id} className="space-y-1">
                <p className="text-xs font-medium text-foreground">
                  {besoin.besoins_operations.nom} ({assigned.length}/{required})
                </p>
                <div className="flex flex-wrap gap-1">
                  {assigned.map((assignment) => (
                    <div
                      key={assignment.id}
                      className="text-xs cursor-pointer hover:text-destructive transition-colors"
                      onClick={() => handleRemoveAssignment(assignment.id)}
                    >
                      {assignment.secretaires.first_name} {assignment.secretaires.name}
                    </div>
                  ))}
                  {assigned.length < required && (
                    <Badge
                      variant="outline"
                      className="text-xs cursor-pointer hover:bg-primary/10"
                      onClick={() => handleOpenAssignDialog(besoin.besoins_operations.id, besoin.besoins_operations.nom)}
                    >
                      +
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ChangeSalleDialog
        open={changeSalleOpen}
        onOpenChange={setChangeSalleOpen}
        operation={{
          id: operation.id,
          date: operation.date,
          periode: operation.periode,
          salle_assignee: operation.salle_assignee || '',
          type_intervention_nom: operation.types_intervention.nom
        }}
        onSuccess={() => {
          onUpdate();
          fetchAssignments();
        }}
      />

      {selectedBesoin && (
        <AssignPersonnelDialog
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          operationId={operation.id}
          date={operation.date}
          periode={operation.periode}
          besoinId={selectedBesoin.id}
          besoinNom={selectedBesoin.nom}
          onSuccess={() => {
            fetchAssignments();
            onUpdate();
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Suppression de l'opération
            </DialogTitle>
            <DialogDescription className="space-y-4 pt-2 text-foreground">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium mb-2">Opération concernée :</p>
                  <p className="text-sm text-muted-foreground">
                    Dr. {operation.medecins?.first_name} {operation.medecins?.name} • {operation.types_intervention.code}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(operation.date), 'd MMMM yyyy', { locale: fr })} - {operation.periode === 'matin' ? 'Matin' : 'Après-midi'}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Conséquences :</p>
                  <p className="text-sm text-muted-foreground">
                    • Personnel libéré : {assignments.length} personne{assignments.length > 1 ? 's' : ''}
                  </p>
                  {operation.salle_assignee && (
                    <p className="text-sm text-muted-foreground">
                      • Salle {operation.salles_operation?.name} libérée
                    </p>
                  )}
                </div>

                <p className="text-sm font-medium pt-2">Que voulez-vous faire ?</p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Annuler
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteCompletely}
            >
              Supprimer
            </Button>
            <Button 
              variant="default"
              onClick={() => {
                setDeleteDialogOpen(false);
                setReassignDialogOpen(true);
              }}
            >
              Réaffecter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign Dialog */}
      {besoinEffectifId && (
        <ReassignOperationDialog
          open={reassignDialogOpen}
          onOpenChange={setReassignDialogOpen}
          besoinEffectifId={besoinEffectifId}
          currentDate={operation.date}
          currentPeriode={operation.periode}
          currentMedecinId={operation.medecins?.id || null}
          onSuccess={handleReassignSuccess}
        />
      )}
    </>
  );
};
