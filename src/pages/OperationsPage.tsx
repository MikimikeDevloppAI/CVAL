import { useState, useEffect } from 'react';
import { format, startOfWeek, addWeeks, subWeeks, eachDayOfInterval, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationDayCard } from '@/components/operations/OperationDayCard';
import { AddOperationDialog } from '@/components/operations/AddOperationDialog';
import { TypesInterventionManagement } from '@/components/blocOperatoire/TypesInterventionManagement';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ChevronLeft, Calendar, Settings, Plus } from 'lucide-react';

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
  const navigate = useNavigate();
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'planning' | 'configuration'>('planning');
  const [addOperationOpen, setAddOperationOpen] = useState(false);
  const [weekOptions, setWeekOptions] = useState<Array<{ value: string; label: string }>>([]);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1, locale: fr });
  const weekDays = eachDayOfInterval({ 
    start: weekStart, 
    end: addWeeks(weekStart, 1) 
  }).slice(0, 5); // Lundi à Vendredi

  useEffect(() => {
    generateWeekOptions();
  }, []);

  const generateWeekOptions = async () => {
    try {
      // Get max date from besoin_effectif
      const { data: maxDateData, error: maxDateError } = await supabase
        .from('besoin_effectif')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (maxDateError) throw maxDateError;

      const maxDate = maxDateData?.date ? new Date(maxDateData.date) : addWeeks(new Date(), 12);
      const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1, locale: fr });
      const maxWeekStart = startOfWeek(maxDate, { weekStartsOn: 1, locale: fr });

      // Calculate number of weeks from current to max
      const weeksCount = Math.ceil((maxWeekStart.getTime() - currentWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

      // Generate weeks from current week to max week
      const options = Array.from({ length: weeksCount }, (_, i) => {
        const weekDate = addWeeks(currentWeekStart, i);
        return {
          value: format(weekDate, 'yyyy-MM-dd'),
          label: `Semaine du ${format(weekDate, 'd MMM yyyy', { locale: fr })}`
        };
      });

      setWeekOptions(options);
    } catch (error) {
      console.error('Error generating week options:', error);
      // Fallback: generate 12 weeks from now
      const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1, locale: fr });
      const options = Array.from({ length: 12 }, (_, i) => {
        const weekDate = addWeeks(currentWeekStart, i);
        return {
          value: format(weekDate, 'yyyy-MM-dd'),
          label: `Semaine du ${format(weekDate, 'd MMM yyyy', { locale: fr })}`
        };
      });
      setWeekOptions(options);
    }
  };

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
  }, [currentWeek]);

  const fetchOperations = async () => {
    try {
      setLoading(true);
      const startDate = format(weekStart, 'yyyy-MM-dd');
      const endDate = format(addWeeks(weekStart, 1), 'yyyy-MM-dd');

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
        .gte('date', startDate)
        .lte('date', endDate)
        .in('periode', ['matin', 'apres_midi'])
        .neq('statut', 'annule')
        .order('date')
        .order('periode');

      if (error) throw error;
      
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

  const handlePreviousWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1));
  };

  const handleToday = () => {
    setCurrentWeek(new Date());
  };

  const handleWeekChange = (weekValue: string) => {
    const selectedDate = new Date(weekValue);
    setCurrentWeek(selectedDate);
  };

  return (
    <div className="w-full space-y-6">
      {/* Header avec Retour et Onglets */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Retour Dashboard
        </Button>

        <div className="inline-flex gap-2 p-1 rounded-xl bg-background/50 backdrop-blur-sm border border-border/50 shadow-sm">
          <button
            onClick={() => setActiveTab('planning')}
            className={`
              relative px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200 ease-in-out
              flex items-center gap-2
              ${activeTab === 'planning' 
                ? 'bg-primary text-primary-foreground shadow-md scale-[1.02]' 
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }
            `}
          >
            <Calendar className="h-4 w-4" />
            <span>Planning</span>
          </button>
          <button
            onClick={() => setActiveTab('configuration')}
            className={`
              relative px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200 ease-in-out
              flex items-center gap-2
              ${activeTab === 'configuration' 
                ? 'bg-primary text-primary-foreground shadow-md scale-[1.02]' 
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }
            `}
          >
            <Settings className="h-4 w-4" />
            <span>Configuration</span>
          </button>
        </div>
      </div>

      {/* Navigation Semaine */}
      {activeTab === 'planning' && (
        <div className="flex items-center justify-between bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <Select 
              value={format(weekStart, 'yyyy-MM-dd')} 
              onValueChange={handleWeekChange}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weekOptions.map((week) => (
                  <SelectItem key={week.value} value={week.value}>
                    {week.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              className="hover:bg-primary/10"
            >
              Aujourd'hui
            </Button>
          </div>

          <Button
            onClick={() => setAddOperationOpen(true)}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Ajouter une opération
          </Button>
        </div>
      )}

      {/* Contenu */}
      {activeTab === 'planning' ? (
        loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {weekDays.map((day, index) => (
              <OperationDayCard
                key={format(day, 'yyyy-MM-dd')}
                date={day}
                operations={getOperationsForDay(day)}
                index={index}
                onUpdate={fetchOperations}
              />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-8">
          <div className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6 shadow-lg">
            <h2 className="text-2xl font-semibold text-foreground mb-6">Types d'intervention</h2>
            <TypesInterventionManagement />
          </div>
        </div>
      )}

      {/* Add Operation Dialog */}
      <AddOperationDialog
        open={addOperationOpen}
        onOpenChange={setAddOperationOpen}
        currentWeekStart={weekStart}
        onSuccess={fetchOperations}
      />
    </div>
  );
};

export default OperationsPage;
