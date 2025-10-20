import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, Users, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ChangeSalleDialog } from '@/components/planning/ChangeSalleDialog';
import { AssignPersonnelDialog } from './AssignPersonnelDialog';
import { cn } from '@/lib/utils';

interface Operation {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  salle_assignee: string | null;
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

  useEffect(() => {
    fetchBesoins();
    fetchAssignments();
  }, [operation.id]);

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
    if (name.includes('verte')) return 'bg-green-100 text-green-700 border-green-300';
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

  return (
    <>
      <div className="rounded-lg border border-border p-3 space-y-3 bg-transparent hover:shadow-md transition-shadow">
        {/* Period and Room */}
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary" className="text-xs">
            {operation.periode === 'matin' ? '🌅 Matin' : '🌆 Après-midi'}
          </Badge>
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
        </div>

        {/* Doctor */}
        <div className="flex items-center gap-2 text-sm">
          <Stethoscope className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">
            Dr. {operation.medecins?.first_name} {operation.medecins?.name}
          </span>
        </div>

        {/* Intervention Type */}
        <Badge variant="secondary" className="text-xs">
          {operation.types_intervention.code}
        </Badge>

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
                    <Badge
                      key={assignment.id}
                      variant="outline"
                      className="text-xs cursor-pointer hover:bg-destructive/10"
                      onClick={() => handleRemoveAssignment(assignment.id)}
                    >
                      {assignment.secretaires.first_name[0]}{assignment.secretaires.name[0]}
                    </Badge>
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
    </>
  );
};
