import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { OptimizationResult } from '@/types/planning';
import { format, endOfWeek } from 'date-fns';

interface PlanningOptimizerProps {
  weekStart: Date;
  onOptimizationComplete: (result: OptimizationResult) => void;
}

export function PlanningOptimizer({ weekStart, onOptimizationComplete }: PlanningOptimizerProps) {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [hasExistingPlanning, setHasExistingPlanning] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    checkExistingPlanning();
  }, [weekStart]);

  const checkExistingPlanning = async () => {
    try {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const { data, error } = await supabase
        .from('planning_genere')
        .select('id')
        .gte('date', format(weekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'))
        .limit(1);

      if (error) throw error;
      setHasExistingPlanning(data && data.length > 0);
    } catch (error) {
      console.error('Erreur lors de la vérification du planning:', error);
    }
  };

  const handleOptimize = async () => {
    setIsOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke('optimize-planning', {
        body: {
          weekStart: weekStart.toISOString(),
        },
      });

      if (error) throw error;

      onOptimizationComplete(data as OptimizationResult);
      setHasExistingPlanning(true);
      
      toast({
        title: "Planning généré avec succès",
        description: `✅ ${data.stats.satisfait} satisfaits | ⚠️ ${data.stats.partiel} partiels | ❌ ${data.stats.non_satisfait} non satisfaits`,
      });
    } catch (error: any) {
      console.error('Optimization error:', error);
      toast({
        title: "Erreur lors de la génération",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <Button 
      onClick={handleOptimize} 
      disabled={isOptimizing}
      size="lg"
      className="gap-2"
    >
      {isOptimizing ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Génération en cours...
        </>
      ) : (
        <>
          <Zap className="h-4 w-4" />
          {hasExistingPlanning ? 'Regénérer le planning optimal' : 'Générer le planning optimal'}
        </>
      )}
    </Button>
  );
}
