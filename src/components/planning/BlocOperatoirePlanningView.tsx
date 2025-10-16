import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, Scissors, Users, Clock, MapPin } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { ChangeSalleDialog } from './ChangeSalleDialog';
import ChangePersonnelDialog from './ChangePersonnelDialog';

interface BlocOperation {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi' | 'toute_journee';
  salle_assignee: string;
  type_intervention_id: string;
  medecin_id: string;
  statut: string;
  type_intervention?: {
    nom: string;
    code: string;
  };
  medecin?: {
    first_name: string;
    name: string;
  };
  personnel: PersonnelAssignment[];
}

interface PersonnelAssignment {
  id: string;
  besoin_operation_id: string | null;
  besoin_operation_nom?: string;
  ordre: number;
  secretaire_id: string | null;
  secretaire?: {
    first_name: string;
    name: string;
  };
}

interface BlocOperatoirePlanningViewProps {
  startDate: Date;
  endDate: Date;
}


const PERIODE_LABELS: Record<string, string> = {
  matin: 'Matin',
  apres_midi: 'Après-midi',
  toute_journee: 'Toute la journée'
};

const SALLE_COLORS: Record<string, string> = {
  rouge: 'bg-red-100 text-red-800 border-red-300',
  verte: 'bg-green-100 text-green-800 border-green-300',
  jaune: 'bg-yellow-100 text-yellow-800 border-yellow-300'
};

export function BlocOperatoirePlanningView({ startDate, endDate }: BlocOperatoirePlanningViewProps) {
  const [operations, setOperations] = useState<BlocOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [changeSalleDialogOpen, setChangeSalleDialogOpen] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState<any>(null);
  const [changePersonnelDialogOpen, setChangePersonnelDialogOpen] = useState(false);
  const [selectedPersonnel, setSelectedPersonnel] = useState<any>(null);

  useEffect(() => {
    fetchBlocOperations();
  }, [startDate, endDate]);

  const handleChangeSalle = (operation: BlocOperation) => {
    setSelectedOperation({
      id: operation.id,
      date: operation.date,
      periode: operation.periode,
      salle_assignee: operation.salle_assignee,
      type_intervention_nom: operation.type_intervention?.nom || 'Type non défini',
    });
    setChangeSalleDialogOpen(true);
  };

  const handleChangePersonnel = (personnel: PersonnelAssignment, operation: BlocOperation) => {
    setSelectedPersonnel({
      id: personnel.id,
      besoin_operation_id: personnel.besoin_operation_id,
      besoin_operation_nom: personnel.besoin_operation_nom,
      secretaire_id: personnel.secretaire_id,
      secretaire_nom: personnel.secretaire 
        ? `${personnel.secretaire.first_name} ${personnel.secretaire.name}`
        : null,
      date: operation.date,
      periode: operation.periode,
      operation_nom: operation.type_intervention?.nom || 'Type non défini',
      planning_genere_bloc_operatoire_id: operation.id,
    });
    setChangePersonnelDialogOpen(true);
  };

  const fetchBlocOperations = async () => {
    setLoading(true);
    try {
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');

      // Fetch bloc operations
      const { data: blocsData, error: blocsError } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select(`
          *,
          type_intervention:types_intervention(nom, code),
          medecin:medecins(first_name, name)
        `)
        .gte('date', startDateStr)
        .lte('date', endDateStr)
        .order('date', { ascending: true })
        .order('periode', { ascending: true });

      if (blocsError) throw blocsError;

      // Fetch personnel for each operation from unified planning_genere_personnel
      const operationsWithPersonnel: BlocOperation[] = [];
      
      for (const bloc of blocsData || []) {
        const { data: personnelData, error: personnelError } = await supabase
          .from('planning_genere_personnel')
          .select(`
            id,
            ordre,
            besoin_operation_id,
            besoin_operation:besoins_operations!besoin_operation_id(nom),
            secretaire:secretaires!secretaire_id(first_name, name),
            secretaire_id
          `)
          .eq('planning_genere_bloc_operatoire_id', bloc.id)
          .eq('type_assignation', 'bloc')
          .order('besoin_operation_id', { ascending: true })
          .order('ordre', { ascending: true });

        if (personnelError) throw personnelError;

        // Transform to match expected PersonnelAssignment interface
        const personnel = (personnelData || []).map((p: any) => ({
          id: p.id,
          ordre: p.ordre,
          besoin_operation_id: p.besoin_operation_id,
          besoin_operation_nom: p.besoin_operation?.nom,
          secretaire_id: p.secretaire_id,
          secretaire: p.secretaire
        }));

        operationsWithPersonnel.push({
          ...bloc,
          personnel
        });
      }

      setOperations(operationsWithPersonnel);
    } catch (error) {
      console.error('Error fetching bloc operations:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (operations.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Aucune opération planifiée pour cette période
        </CardContent>
      </Card>
    );
  }

  // Group operations by date
  const operationsByDate = operations.reduce((acc, op) => {
    if (!acc[op.date]) acc[op.date] = [];
    acc[op.date].push(op);
    return acc;
  }, {} as Record<string, BlocOperation[]>);

  return (
    <div className="space-y-6">
      {Object.entries(operationsByDate).map(([date, dayOperations]) => (
        <Card key={date}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {format(new Date(date), 'EEEE d MMMM yyyy', { locale: fr })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {dayOperations.map((operation, idx) => (
                <div key={operation.id}>
                  {idx > 0 && <Separator className="my-6" />}
                  
                  <div className="space-y-4">
                    {/* En-tête de l'opération */}
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="text-base px-3 py-1">
                            {PERIODE_LABELS[operation.periode]}
                          </Badge>
                          <button onClick={() => handleChangeSalle(operation)}>
                            <Badge 
                              className={`text-base px-3 py-1 ${SALLE_COLORS[operation.salle_assignee] || 'bg-gray-100'} cursor-pointer hover:opacity-80 transition-opacity`}
                              variant="outline"
                            >
                              <MapPin className="h-4 w-4 mr-1" />
                              Salle {operation.salle_assignee}
                            </Badge>
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Scissors className="h-5 w-5 text-muted-foreground" />
                          <span className="font-semibold text-lg">
                            {operation.type_intervention?.nom || 'Type non défini'}
                          </span>
                          {operation.type_intervention?.code && (
                            <Badge variant="secondary" className="ml-2">
                              {operation.type_intervention.code}
                            </Badge>
                          )}
                        </div>
                        
                        {operation.medecin && (
                          <div className="text-muted-foreground">
                            Dr. {operation.medecin.first_name} {operation.medecin.name}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Personnel assigné */}
                    <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Personnel assigné</span>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {operation.personnel.map((p) => (
                          <div 
                            key={p.id} 
                            className="flex items-center justify-between p-3 bg-background rounded border cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => handleChangePersonnel(p, operation)}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {p.besoin_operation_nom || 'Personnel'}
                              </Badge>
                              {p.ordre > 1 && (
                                <span className="text-xs text-muted-foreground">#{p.ordre}</span>
                              )}
                            </div>
                            
                            <div className="font-medium">
                              {p.secretaire ? (
                                <span className="text-sm">
                                  {p.secretaire.first_name} {p.secretaire.name}
                                </span>
                              ) : (
                                <span className="text-sm text-muted-foreground italic">
                                  Non assigné
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {operation.personnel.length === 0 && (
                        <div className="text-center text-muted-foreground text-sm py-4">
                          Aucun personnel défini pour cette opération
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {selectedOperation && (
        <ChangeSalleDialog
          open={changeSalleDialogOpen}
          onOpenChange={setChangeSalleDialogOpen}
          operation={selectedOperation}
          onSuccess={() => {
            fetchBlocOperations();
            setSelectedOperation(null);
          }}
        />
      )}

      {selectedPersonnel && (
        <ChangePersonnelDialog
          open={changePersonnelDialogOpen}
          onOpenChange={setChangePersonnelDialogOpen}
          assignment={selectedPersonnel}
          onSuccess={() => {
            fetchBlocOperations();
            setSelectedPersonnel(null);
          }}
        />
      )}
    </div>
  );
}
