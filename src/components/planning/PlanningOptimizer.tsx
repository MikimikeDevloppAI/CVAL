import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PlanningOptimizerProps {
  weekStart: Date;
  onOptimizationComplete: (result: any) => void;
}

export function PlanningOptimizer({ weekStart, onOptimizationComplete }: PlanningOptimizerProps) {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const { toast } = useToast();

  const handleOptimize = async () => {
    setIsOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke('optimize-planning', {
        body: {
          weekStart: weekStart.toISOString(),
        },
      });

      if (error) throw error;

      onOptimizationComplete(data);
      
      toast({
        title: "Optimisation simple terminée",
        description: `${data.stats.assignees_specialites} secrétaires assignées, ${data.stats.assignees_administratif} en administratif`,
      });
    } catch (error: any) {
      console.error('Optimization error:', error);
      toast({
        title: "Erreur lors de l'optimisation",
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
          Optimisation en cours...
        </>
      ) : (
        <>
          <Zap className="h-4 w-4" />
          Tester l'optimisation simple
        </>
      )}
    </Button>
  );
}
