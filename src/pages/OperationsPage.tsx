import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationDayCard } from '@/components/operations/OperationDayCard';
import { TypesInterventionManagement } from '@/components/blocOperatoire/TypesInterventionManagement';
import { ConfigurationsMultiFluxManagement } from '@/components/blocOperatoire/ConfigurationsMultiFluxManagement';
import { WeekSelector } from '@/components/shared/WeekSelector';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft } from 'lucide-react';

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

const OperationsPage = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  useEffect(() => {
    fetchOperations();
    
    const channel = supabase
      .channel('operations-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'planning_genere_bloc_operatoire'
      }, () => {
        fetchOperations();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'capacite_effective'
      }, () => {
        fetchOperations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentDate]);

  const fetchOperations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select(`
          id,
          date,
          periode,
          salle_assignee,
          salles_operation (
            id,
            name
          ),
          medecins (
            id,
            first_name,
            name
          ),
          types_intervention (
            id,
            nom,
            code
          )
        `)
        .gte('date', format(weekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'))
        .in('periode', ['matin', 'apres_midi'])
        .neq('statut', 'annule')
        .order('date')
        .order('periode');

      if (error) throw error;
      
      // Filter and type-cast to ensure only matin/apres_midi periods
      const filteredData = (data || []).filter(
        (op): op is Operation => op.periode === 'matin' || op.periode === 'apres_midi'
      );
      
      setOperations(filteredData);
    } catch (error) {
      console.error('Error fetching operations:', error);
      toast.error('Erreur lors du chargement des opérations');
    } finally {
      setLoading(false);
    }
  };

  const getOperationsForDay = (date: Date) => {
    return operations.filter(
      (op) => op.date === format(date, 'yyyy-MM-dd')
    );
  };

  return (
    <div className="min-h-screen">
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => window.location.href = '/'}
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Retour Dashboard
          </Button>
          <WeekSelector
            currentDate={currentDate}
            onWeekChange={setCurrentDate}
          />
        </div>

        <Tabs defaultValue="planning" className="space-y-6">
          <TabsList className="bg-card/50 backdrop-blur-xl border border-border/50">
            <TabsTrigger value="planning">Planning</TabsTrigger>
            <TabsTrigger value="configuration">Configuration</TabsTrigger>
          </TabsList>

          <TabsContent value="planning" className="space-y-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {weekDays
                  .filter(day => format(day, 'E', { locale: fr }) !== 'sam' && format(day, 'E', { locale: fr }) !== 'dim')
                  .map((day, index) => (
                    <OperationDayCard
                      key={format(day, 'yyyy-MM-dd')}
                      date={day}
                      operations={getOperationsForDay(day)}
                      index={index}
                      onUpdate={fetchOperations}
                    />
                  ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="configuration" className="space-y-6">
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-semibold text-foreground mb-4">Types d'intervention</h2>
                <TypesInterventionManagement />
              </div>
              
              <div>
                <h2 className="text-2xl font-semibold text-foreground mb-4">Configurations Multi-flux</h2>
                <ConfigurationsMultiFluxManagement />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default OperationsPage;
