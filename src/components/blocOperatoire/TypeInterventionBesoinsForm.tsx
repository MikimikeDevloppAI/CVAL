import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface TypeInterventionBesoinsFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  typeInterventionId: string;
  typeInterventionNom: string;
}

interface BesoinOperation {
  id: string;
  code: string;
  nom: string;
  categorie?: string;
}

interface BesoinPersonnel {
  besoin_operation_id: string;
  nombre_requis: number;
}

export function TypeInterventionBesoinsForm({
  open,
  onOpenChange,
  typeInterventionId,
  typeInterventionNom,
}: TypeInterventionBesoinsFormProps) {
  const [besoins, setBesoins] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [besoinsOperations, setBesoinsOperations] = useState<BesoinOperation[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchBesoinsOperations();
    }
  }, [open]);

  useEffect(() => {
    if (open && typeInterventionId && besoinsOperations.length > 0) {
      fetchBesoins();
    }
  }, [open, typeInterventionId, besoinsOperations]);

  const fetchBesoinsOperations = async () => {
    try {
      const { data, error } = await supabase
        .from('besoins_operations')
        .select('*')
        .eq('actif', true)
        .order('categorie', { ascending: true })
        .order('nom', { ascending: true });

      if (error) throw error;
      setBesoinsOperations(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des types de besoins:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les types de besoins',
        variant: 'destructive',
      });
    }
  };

  const fetchBesoins = async () => {
    try {
      const { data, error } = await supabase
        .from('types_intervention_besoins_personnel')
        .select('besoin_operation_id, nombre_requis')
        .eq('type_intervention_id', typeInterventionId)
        .eq('actif', true);

      if (error) throw error;

      const besoinsMap: Record<string, number> = {};
      data?.forEach((besoin) => {
        besoinsMap[besoin.besoin_operation_id] = besoin.nombre_requis;
      });
      setBesoins(besoinsMap);
    } catch (error) {
      console.error('Erreur lors du chargement des besoins:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les besoins en personnel',
        variant: 'destructive',
      });
    }
  };

  const handleChange = (besoinId: string, value: string) => {
    const nombre = parseInt(value) || 0;
    setBesoins((prev) => ({
      ...prev,
      [besoinId]: nombre,
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Supprimer tous les besoins existants pour ce type d'intervention
      await supabase
        .from('types_intervention_besoins_personnel')
        .delete()
        .eq('type_intervention_id', typeInterventionId);

      // Insérer les nouveaux besoins (seulement ceux avec nombre > 0)
      const besoinsToInsert = Object.entries(besoins)
        .filter(([_, nombre]) => nombre > 0)
        .map(([besoin_operation_id, nombre_requis]) => ({
          type_intervention_id: typeInterventionId,
          besoin_operation_id,
          nombre_requis,
          actif: true,
        }));

      if (besoinsToInsert.length > 0) {
        const { error } = await supabase
          .from('types_intervention_besoins_personnel')
          .insert(besoinsToInsert);

        if (error) throw error;
      }

      toast({
        title: 'Succès',
        description: 'Besoins en personnel enregistrés',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Erreur lors de l\'enregistrement:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enregistrer les besoins',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Besoins en personnel - {typeInterventionNom}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Définissez le nombre de personnes nécessaires pour chaque rôle lors de ce type d'intervention.
          </p>

          <div className="grid gap-4">
            {besoinsOperations.map((besoin) => (
              <div key={besoin.id} className="flex items-center gap-4">
                <Label htmlFor={besoin.id} className="flex-1 font-medium">
                  {besoin.nom}
                  {besoin.categorie && (
                    <span className="text-xs text-muted-foreground ml-2">
                      ({besoin.categorie})
                    </span>
                  )}
                </Label>
                <Input
                  id={besoin.id}
                  type="number"
                  min="0"
                  max="10"
                  value={besoins[besoin.id] || 0}
                  onChange={(e) => handleChange(besoin.id, e.target.value)}
                  className="w-24"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
