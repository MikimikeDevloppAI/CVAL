import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * Component to manually trigger MILP base schedule optimization
 * This should replace automatic triggers temporarily for testing
 */
export function BaseScheduleOptimizationTrigger() {
  const { toast } = useToast();

  const triggerOptimization = async () => {
    try {
      toast({
        title: "Optimisation en cours",
        description: "L'algorithme MILP est en train de calculer...",
      });

      const { data, error } = await supabase.functions.invoke('optimize-base-schedule-milp');

      if (error) throw error;

      toast({
        title: "Optimisation terminée",
        description: `${data.stats.total_assignments} assignations créées (satisfaction: ${data.stats.satisfaction_rate})`,
      });
    } catch (error: any) {
      console.error('Optimization error:', error);
      toast({
        title: "Erreur lors de l'optimisation",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return null; // This component doesn't render anything, it's just for manual triggering
}
