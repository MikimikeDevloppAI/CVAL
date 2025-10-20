import { useState, useEffect } from 'react';
import { format, startOfWeek, addWeeks, subWeeks, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationDayCard } from '@/components/operations/OperationDayCard';
import { TypesInterventionManagement } from '@/components/blocOperatoire/TypesInterventionManagement';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight, Calendar, Settings } from 'lucide-react';

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

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1, locale: fr });
  const weekDays = eachDayOfInterval({ 
    start: weekStart, 
    end: addWeeks(weekStart, 1) 
  }).slice(0, 5); // Lundi à Vendredi

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
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePreviousWeek}
            className="hover:bg-primary/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Semaine du</p>
              <p className="text-lg font-semibold">
                {format(weekStart, 'dd MMMM yyyy', { locale: fr })}
              </p>
            </div>
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
            variant="ghost"
            size="icon"
            onClick={handleNextWeek}
            className="hover:bg-primary/10"
          >
            <ChevronRight className="h-5 w-5" />
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
    </div>
  );
};

export default OperationsPage;
