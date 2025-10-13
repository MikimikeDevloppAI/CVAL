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

interface BesoinPersonnel {
  type_besoin: 'anesthesiste' | 'instrumentiste' | 'instrumentiste_aide_salle' | 'aide_salle' | 'accueil';
  nombre_requis: number;
}

const TYPES_BESOINS: Array<{ value: 'anesthesiste' | 'instrumentiste' | 'instrumentiste_aide_salle' | 'aide_salle' | 'accueil'; label: string }> = [
  { value: 'anesthesiste', label: 'Anesthésiste' },
  { value: 'instrumentiste', label: 'Instrumentiste' },
  { value: 'instrumentiste_aide_salle', label: 'Instrumentiste / Aide de salle' },
  { value: 'aide_salle', label: 'Aide de salle' },
  { value: 'accueil', label: 'Accueil' },
];

export function TypeInterventionBesoinsForm({
  open,
  onOpenChange,
  typeInterventionId,
  typeInterventionNom,
}: TypeInterventionBesoinsFormProps) {
  const [besoins, setBesoins] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && typeInterventionId) {
      fetchBesoins();
    }
  }, [open, typeInterventionId]);

  const fetchBesoins = async () => {
    try {
      const { data, error } = await supabase
        .from('types_intervention_besoins_personnel')
        .select('type_besoin, nombre_requis')
        .eq('type_intervention_id', typeInterventionId)
        .eq('actif', true);

      if (error) throw error;

      const besoinsMap: Record<string, number> = {};
      data?.forEach((besoin) => {
        besoinsMap[besoin.type_besoin] = besoin.nombre_requis;
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

  const handleChange = (typeBesoin: 'anesthesiste' | 'instrumentiste' | 'instrumentiste_aide_salle' | 'aide_salle' | 'accueil', value: string) => {
    const nombre = parseInt(value) || 0;
    setBesoins((prev) => ({
      ...prev,
      [typeBesoin]: nombre,
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
        .map(([type_besoin, nombre_requis]) => ({
          type_intervention_id: typeInterventionId,
          type_besoin: type_besoin as 'anesthesiste' | 'instrumentiste' | 'instrumentiste_aide_salle' | 'aide_salle' | 'accueil',
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
            {TYPES_BESOINS.map((type) => (
              <div key={type.value} className="flex items-center gap-4">
                <Label htmlFor={type.value} className="flex-1 font-medium">
                  {type.label}
                </Label>
                <Input
                  id={type.value}
                  type="number"
                  min="0"
                  max="10"
                  value={besoins[type.value] || 0}
                  onChange={(e) => handleChange(type.value, e.target.value)}
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
