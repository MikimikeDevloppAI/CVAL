import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, Scissors, Users, Clock, MapPin } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

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

interface BlocOperatoirePlanningViewProps {
  startDate: Date;
  endDate: Date;
}

const TYPE_BESOIN_LABELS: Record<string, string> = {
  instrumentiste: 'Instrumentiste',
  aide_salle: 'Aide de salle',
  instrumentiste_aide_salle: 'Instrumentiste/Aide de salle',
  anesthesiste: 'Anesthésiste',
  accueil_dermato: 'Accueil Dermato',
  accueil_ophtalmo: 'Accueil Ophtalmo',
};

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

  useEffect(() => {
    fetchBlocOperations();
  }, [startDate, endDate]);

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

      // Fetch personnel for each operation
      const operationsWithPersonnel: BlocOperation[] = [];
      
      for (const bloc of blocsData || []) {
        const { data: personnelData, error: personnelError } = await supabase
          .from('planning_genere_bloc_personnel')
          .select(`
            *,
            secretaire:secretaires(first_name, name)
          `)
          .eq('planning_genere_bloc_operatoire_id', bloc.id)
          .order('type_besoin', { ascending: true })
          .order('ordre', { ascending: true });

        if (personnelError) throw personnelError;

        operationsWithPersonnel.push({
          ...bloc,
          personnel: personnelData || []
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
                          <Badge 
                            className={`text-base px-3 py-1 ${SALLE_COLORS[operation.salle_assignee] || 'bg-gray-100'}`}
                            variant="outline"
                          >
                            <MapPin className="h-4 w-4 mr-1" />
                            Salle {operation.salle_assignee}
                          </Badge>
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
                            className="flex items-center justify-between p-3 bg-background rounded border"
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {TYPE_BESOIN_LABELS[p.type_besoin] || p.type_besoin}
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
    </div>
  );
}
