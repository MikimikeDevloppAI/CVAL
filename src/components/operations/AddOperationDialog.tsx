import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { format, addDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
}

interface Medecin {
  id: string;
  first_name: string;
  name: string;
}

interface AddOperationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentWeekStart: Date;
  onSuccess: () => void;
}

const BLOC_OPERATOIRE_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';

export const AddOperationDialog = ({
  open,
  onOpenChange,
  currentWeekStart,
  onSuccess
}: AddOperationDialogProps) => {
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');
  const [selectedMedecinId, setSelectedMedecinId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedPeriode, setSelectedPeriode] = useState<'matin' | 'apres_midi' | ''>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Generate dates for the week (Monday to Friday)
  const weekDates = Array.from({ length: 5 }, (_, i) => {
    const date = addDays(currentWeekStart, i);
    return {
      value: format(date, 'yyyy-MM-dd'),
      label: format(date, 'EEEE d MMMM', { locale: fr })
    };
  });

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedTypeInterventionId('');
      setSelectedMedecinId('');
      setSelectedDate('');
      setSelectedPeriode('');
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch active intervention types
      const { data: typesData, error: typesError } = await supabase
        .from('types_intervention')
        .select('id, nom, code')
        .eq('actif', true)
        .order('nom');

      if (typesError) throw typesError;

      const sortedTypes = (typesData || []).sort((a, b) => 
        a.nom.localeCompare(b.nom)
      );
      setTypesIntervention(sortedTypes);

      // Fetch active medecins
      const { data: medecinsData, error: medecinsError } = await supabase
        .from('medecins')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('name');

      if (medecinsError) throw medecinsError;

      const sortedMedecins = (medecinsData || []).sort((a, b) => {
        const nameA = `${a.first_name} ${a.name}`.toLowerCase();
        const nameB = `${b.first_name} ${b.name}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });
      setMedecins(sortedMedecins);
    } catch (error: any) {
      console.error('Erreur lors du chargement des données:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedTypeInterventionId || !selectedMedecinId || !selectedDate || !selectedPeriode) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    setSubmitting(true);
    try {
      // Check if a besoin_effectif already exists for this date/period/type/medecin
      const { data: existingBesoin, error: checkError } = await supabase
        .from('besoin_effectif')
        .select('id')
        .eq('date', selectedDate)
        .eq('demi_journee', selectedPeriode)
        .eq('type', 'bloc_operatoire')
        .eq('type_intervention_id', selectedTypeInterventionId)
        .eq('medecin_id', selectedMedecinId)
        .maybeSingle();

      if (checkError) throw checkError;

      // If exists, delete it first (triggers will cascade delete planning and free personnel)
      if (existingBesoin) {
        const { error: deleteError } = await supabase
          .from('besoin_effectif')
          .delete()
          .eq('id', existingBesoin.id);

        if (deleteError) throw deleteError;
      }

      // Create new besoin_effectif
      const newBesoin = {
        date: selectedDate,
        demi_journee: selectedPeriode,
        medecin_id: selectedMedecinId,
        site_id: BLOC_OPERATOIRE_SITE_ID,
        type: 'bloc_operatoire' as const,
        type_intervention_id: selectedTypeInterventionId,
        actif: true
      };

      const { error: insertError } = await supabase
        .from('besoin_effectif')
        .insert([newBesoin]);

      if (insertError) throw insertError;

      toast.success('Opération ajoutée avec succès');
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Erreur lors de l\'ajout de l\'opération:', error);
      toast.error('Erreur lors de l\'ajout de l\'opération: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajouter une opération</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="site">Site</Label>
              <Select value={BLOC_OPERATOIRE_SITE_ID} disabled>
                <SelectTrigger id="site">
                  <SelectValue placeholder="Clinique La Vallée - Bloc opératoire" />
                </SelectTrigger>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type-intervention">Type d'intervention</Label>
              <Select value={selectedTypeInterventionId} onValueChange={setSelectedTypeInterventionId}>
                <SelectTrigger id="type-intervention">
                  <SelectValue placeholder="Sélectionner un type" />
                </SelectTrigger>
                <SelectContent>
                  {typesIntervention.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="medecin">Médecin</Label>
              <Select value={selectedMedecinId} onValueChange={setSelectedMedecinId}>
                <SelectTrigger id="medecin">
                  <SelectValue placeholder="Sélectionner un médecin" />
                </SelectTrigger>
                <SelectContent>
                  {medecins.map((medecin) => (
                    <SelectItem key={medecin.id} value={medecin.id}>
                      Dr. {medecin.first_name} {medecin.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger id="date">
                  <SelectValue placeholder="Sélectionner une date" />
                </SelectTrigger>
                <SelectContent>
                  {weekDates.map((date) => (
                    <SelectItem key={date.value} value={date.value}>
                      {date.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="periode">Période</Label>
              <Select value={selectedPeriode} onValueChange={(value) => setSelectedPeriode(value as 'matin' | 'apres_midi')}>
                <SelectTrigger id="periode">
                  <SelectValue placeholder="Sélectionner une période" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matin">Matin</SelectItem>
                  <SelectItem value="apres_midi">Après-midi</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
