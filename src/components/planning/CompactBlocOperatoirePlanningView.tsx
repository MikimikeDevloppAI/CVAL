import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, Scissors, MapPin } from 'lucide-react';

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
  type_besoin: string;
  ordre: number;
  secretaire_id: string | null;
  secretaire?: {
    first_name: string;
    name: string;
  };
}

interface CompactBlocOperatoirePlanningViewProps {
  startDate: Date;
  endDate: Date;
}

const TYPE_BESOIN_LABELS: Record<string, string> = {
  instrumentiste: 'Inst.',
  aide_salle: 'AS',
  instrumentiste_aide_salle: 'Inst./AS',
  anesthesiste: 'Anesth.',
  accueil_dermato: 'Acc. Derm.',
  accueil_ophtalmo: 'Acc. Oph.',
};

const PERIODE_LABELS: Record<string, string> = {
  matin: 'Matin',
  apres_midi: 'Après-midi',
  toute_journee: 'Journée'
};

const SALLE_COLORS: Record<string, string> = {
  rouge: 'bg-red-100 text-red-700 border-red-300',
  verte: 'bg-green-100 text-green-700 border-green-300',
  jaune: 'bg-yellow-100 text-yellow-700 border-yellow-300'
};

export function CompactBlocOperatoirePlanningView({ startDate, endDate }: CompactBlocOperatoirePlanningViewProps) {
  const [operations, setOperations] = useState<BlocOperation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBlocOperations();
  }, [startDate, endDate]);

  const fetchBlocOperations = async () => {
    setLoading(true);
    try {
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');

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

      const operationsWithPersonnel: BlocOperation[] = [];
      
      for (const bloc of blocsData || []) {
        const { data: personnelData, error: personnelError } = await supabase
          .from('planning_genere_personnel')
          .select(`
            id,
            ordre,
            type_besoin_bloc,
            secretaire:secretaires(first_name, name),
            secretaire_id
          `)
          .eq('planning_genere_bloc_operatoire_id', bloc.id)
          .eq('type_assignation', 'bloc')
          .order('type_besoin_bloc', { ascending: true })
          .order('ordre', { ascending: true });

        if (personnelError) throw personnelError;

        // Transform to match expected interface
        const personnel = (personnelData || []).map((p: any) => ({
          id: p.id,
          ordre: p.ordre,
          type_besoin: p.type_besoin_bloc,
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
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (operations.length === 0) {
    return null;
  }

  // Group operations by date
  const operationsByDate = operations.reduce((acc, op) => {
    if (!acc[op.date]) acc[op.date] = [];
    acc[op.date].push(op);
    return acc;
  }, {} as Record<string, BlocOperation[]>);

  return (
    <Card className="mb-4">
      <CardHeader className="bg-primary/5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scissors className="h-4 w-4 text-primary" />
          Bloc Opératoire
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-3">
          {Object.entries(operationsByDate).map(([date, dayOperations]) => (
            <div key={date} className="border rounded-lg p-3 bg-muted/30">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                {format(new Date(date), 'EEEE d MMMM', { locale: fr })}
              </div>
              
              <div className="space-y-2">
                {dayOperations.map((operation) => (
                  <div key={operation.id} className="bg-background rounded border p-2">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-1 flex-wrap">
                          <Badge variant="outline" className="text-xs px-2 py-0">
                            {PERIODE_LABELS[operation.periode]}
                          </Badge>
                          <Badge 
                            className={`text-xs px-2 py-0 ${SALLE_COLORS[operation.salle_assignee] || 'bg-gray-100'}`}
                            variant="outline"
                          >
                            <MapPin className="h-3 w-3 mr-0.5" />
                            Salle {operation.salle_assignee}
                          </Badge>
                          <span className="text-xs font-medium">
                            {operation.type_intervention?.nom || 'Type non défini'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {operation.medecin && (
                        <div className="flex items-center gap-1 bg-muted/50 rounded px-1.5 py-0.5 text-xs">
                          <span className="text-muted-foreground">Docteur</span>
                          <span className="font-medium">
                            {operation.medecin.first_name} {operation.medecin.name}
                          </span>
                        </div>
                      )}
                      
                      {operation.personnel.map((p) => (
                        <div 
                          key={p.id}
                          className="flex items-center gap-1 bg-muted/50 rounded px-1.5 py-0.5 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {TYPE_BESOIN_LABELS[p.type_besoin] || p.type_besoin}
                          </span>
                          <span className="font-medium truncate">
                            {p.secretaire ? (
                              `${p.secretaire.first_name.charAt(0)}. ${p.secretaire.name}`
                            ) : (
                              <span className="text-muted-foreground italic">-</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
