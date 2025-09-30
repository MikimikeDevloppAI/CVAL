import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { OptimizationResult } from '@/types/planning';

interface PlanningOptimizerProps {
  weekStart: Date;
  onOptimizationComplete: (result: OptimizationResult) => void;
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

      onOptimizationComplete(data as OptimizationResult);
      
      toast({
        title: "Planning généré avec succès",
        description: `Score: ${data.score_total.toFixed(2)} (Base: ${data.score_base.toFixed(2)})`,
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
          Générer le planning optimal
        </>
      )}
    </Button>
  );
}
