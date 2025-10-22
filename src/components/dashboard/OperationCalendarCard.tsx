import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, Users, MapPin, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { ChangeSalleDialog } from '@/components/planning/ChangeSalleDialog';
import { DeleteOperationDialog } from '@/components/operations/DeleteOperationDialog';
import { Button } from '@/components/ui/button';
import { SecretaireCalendarDialog } from '@/components/dashboard/secretaires/SecretaireCalendarDialog';

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

interface OperationCalendarCardProps {
  operation: {
    id: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    type_intervention_nom: string;
    type_intervention_code: string;
    type_intervention_id: string;
    medecin_nom: string;
    medecin_id: string | null;
    besoin_effectif_id: string | null;
    salle_nom: string | null;
    salle_assignee: string | null;
  };
  index: number;
  onRefresh?: () => void;
}

export function OperationCalendarCard({ operation, index, onRefresh }: OperationCalendarCardProps) {
  const [besoins, setBesoins] = useState<Besoin[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [changeSalleOpen, setChangeSalleOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSecretaire, setSelectedSecretaire] = useState<{ id: string; nom: string } | null>(null);

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
      .eq('type_intervention_id', operation.type_intervention_id)
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
    if (!salleName) return 'bg-muted/50 text-muted-foreground border-border/50';
    
    const name = salleName.toLowerCase();
    if (name.includes('rouge')) return 'bg-red-50 text-red-700 border-red-200';
    if (name.includes('vert')) return 'bg-green-50 text-green-700 border-green-200';
    if (name.includes('jaune')) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    return 'bg-muted/50 text-muted-foreground border-border/50';
  };

  const getAssignedForBesoin = (besoinId: string) => {
    return assignments.filter(a => a.besoin_operation_id === besoinId);
  };

  const dayOfWeek = format(new Date(operation.date), 'EEEE', { locale: fr });
  const dayDate = format(new Date(operation.date), 'd MMMM', { locale: fr });

  return (
    <div
      className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl shadow-lg overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all duration-300"
      style={{
        animation: `fadeIn 0.5s ease-out ${index * 0.05}s both`
      }}
    >
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-500/10 via-teal-500/10 to-cyan-500/10 p-4 border-b border-border/50 relative">
        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setDeleteDialogOpen(true)}
          title="Supprimer l'opération"
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2 pr-8">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold truncate">
                {operation.type_intervention_nom}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {operation.type_intervention_code}
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <span className="text-foreground font-medium capitalize">
              {dayOfWeek} - {dayDate}
            </span>
            <span className="text-foreground">•</span>
            <Badge 
              variant="outline" 
              className={cn(
                "text-[10px] px-2 py-0.5 font-semibold",
                operation.periode === 'matin' 
                  ? 'bg-blue-500 text-white border-blue-500' 
                  : 'bg-yellow-500 text-white border-yellow-500'
              )}
            >
              {operation.periode === 'matin' ? 'Matin' : 'Après-midi'}
            </Badge>
            {operation.salle_nom && (
              <>
                <span className="text-foreground">•</span>
                <div 
                  className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-semibold border flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity",
                    getSalleColor(operation.salle_nom)
                  )}
                  onClick={() => setChangeSalleOpen(true)}
                  title="Cliquer pour changer de salle"
                >
                  <MapPin className="h-2.5 w-2.5" />
                  {operation.salle_nom}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Doctor */}
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-gradient-to-r from-primary/5 to-transparent border-l-2 border-primary/50">
          <Stethoscope className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="font-semibold text-foreground text-sm">
            Dr. {operation.medecin_nom}
          </span>
        </div>

        {/* Personnel Requirements */}
        {besoins.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <Users className="h-3.5 w-3.5" />
              <span>Personnel</span>
            </div>
            
            {besoins.map((besoin) => {
              const assigned = getAssignedForBesoin(besoin.besoins_operations.id);
              const required = besoin.nombre_requis;
              const isComplete = assigned.length >= required;
              
              return (
                <div key={besoin.besoins_operations.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">
                      {besoin.besoins_operations.nom}
                    </p>
                    <div className={cn(
                      "px-2 py-1 rounded-md text-xs font-semibold",
                      isComplete 
                        ? "bg-green-500/10 text-green-600 border border-green-500/20" 
                        : "bg-orange-500/10 text-orange-600 border border-orange-500/20"
                    )}>
                      {assigned.length}/{required}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {assigned.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="px-3 py-1.5 rounded-lg bg-card/50 border border-border/50 text-xs font-medium text-foreground cursor-pointer hover:bg-primary/10 hover:border-primary/30 transition-all"
                        onClick={() => setSelectedSecretaire({
                          id: assignment.secretaires.id,
                          nom: `${assignment.secretaires.first_name} ${assignment.secretaires.name}`
                        })}
                        title="Cliquer pour voir le calendrier"
                      >
                        {assignment.secretaires.first_name} {assignment.secretaires.name}
                      </div>
                    ))}
                    {assigned.length === 0 && (
                      <div className="px-3 py-1.5 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/20 text-xs text-muted-foreground italic">
                        Aucun personnel assigné
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {operation.salle_assignee && (
        <ChangeSalleDialog
          open={changeSalleOpen}
          onOpenChange={setChangeSalleOpen}
          operation={{
            id: operation.id,
            date: operation.date,
            periode: operation.periode,
            salle_assignee: operation.salle_assignee,
            type_intervention_nom: operation.type_intervention_nom
          }}
          onSuccess={() => {
            fetchBesoins();
            fetchAssignments();
            onRefresh?.();
          }}
        />
      )}

      <DeleteOperationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        operation={{
          id: operation.id,
          besoin_effectif_id: operation.besoin_effectif_id,
          date: operation.date,
          periode: operation.periode,
          type_intervention_nom: operation.type_intervention_nom,
          medecin_id: operation.medecin_id,
          medecin_nom: operation.medecin_nom,
        }}
        onSuccess={() => {
          fetchBesoins();
          fetchAssignments();
          onRefresh?.();
        }}
      />

      {selectedSecretaire && (
        <SecretaireCalendarDialog
          open={!!selectedSecretaire}
          onOpenChange={(open) => !open && setSelectedSecretaire(null)}
          secretaireId={selectedSecretaire.id}
          secretaireNom={selectedSecretaire.nom}
        />
      )}
    </div>
  );
}
