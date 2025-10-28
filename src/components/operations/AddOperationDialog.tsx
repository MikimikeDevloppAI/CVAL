import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
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
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [selectedPeriode, setSelectedPeriode] = useState<'matin' | 'apres_midi' | 'toute_journee' | ''>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedTypeInterventionId('');
      setSelectedMedecinId('');
      setSelectedDates([]);
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

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    
    const isSelected = selectedDates.some(
      d => format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );

    if (isSelected) {
      setSelectedDates(selectedDates.filter(
        d => format(d, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd')
      ));
    } else {
      setSelectedDates([...selectedDates, date]);
    }
  };

  const handleRemoveDate = (dateToRemove: Date) => {
    setSelectedDates(selectedDates.filter(
      d => format(d, 'yyyy-MM-dd') !== format(dateToRemove, 'yyyy-MM-dd')
    ));
  };

  const handleSubmit = async () => {
    if (!selectedTypeInterventionId || !selectedMedecinId || selectedDates.length === 0 || !selectedPeriode) {
      toast.error('Veuillez remplir tous les champs et sélectionner au moins une date');
      return;
    }

    setSubmitting(true);
    try {
      // Prepare all besoins to insert
      const besoinsToInsert = [];
      
      for (const date of selectedDates) {
        const dateString = format(date, 'yyyy-MM-dd');
        
        // Delete existing besoins for this medecin/date/periode
        const periodsToDelete: ('matin' | 'apres_midi' | 'toute_journee')[] = selectedPeriode === 'toute_journee' 
          ? ['matin', 'apres_midi', 'toute_journee']
          : [selectedPeriode] as ('matin' | 'apres_midi')[];

        const { error: deleteError } = await supabase
          .from('besoin_effectif')
          .delete()
          .eq('medecin_id', selectedMedecinId)
          .eq('date', dateString)
          .in('demi_journee', periodsToDelete);

        if (deleteError) throw deleteError;

        // Prepare new besoins
        if (selectedPeriode === 'toute_journee') {
          besoinsToInsert.push(
            {
              date: dateString,
              demi_journee: 'matin',
              medecin_id: selectedMedecinId,
              site_id: BLOC_OPERATOIRE_SITE_ID,
              type: 'medecin' as const,
              type_intervention_id: selectedTypeInterventionId,
              actif: true
            },
            {
              date: dateString,
              demi_journee: 'apres_midi',
              medecin_id: selectedMedecinId,
              site_id: BLOC_OPERATOIRE_SITE_ID,
              type: 'medecin' as const,
              type_intervention_id: selectedTypeInterventionId,
              actif: true
            }
          );
        } else {
          besoinsToInsert.push({
            date: dateString,
            demi_journee: selectedPeriode,
            medecin_id: selectedMedecinId,
            site_id: BLOC_OPERATOIRE_SITE_ID,
            type: 'medecin' as const,
            type_intervention_id: selectedTypeInterventionId,
            actif: true
          });
        }
      }

      // Insert all besoins
      const { error: insertError } = await supabase
        .from('besoin_effectif')
        .insert(besoinsToInsert);

      if (insertError) throw insertError;

      toast.success(`${selectedDates.length} opération(s) ajoutée(s) avec succès`);
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Erreur lors de l\'ajout des opérations:', error);
      toast.error('Erreur lors de l\'ajout des opérations: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajouter des opérations</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4 py-4">
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
              <Label htmlFor="periode">Période</Label>
              <Select value={selectedPeriode} onValueChange={(value) => setSelectedPeriode(value as 'matin' | 'apres_midi' | 'toute_journee')}>
                <SelectTrigger id="periode">
                  <SelectValue placeholder="Sélectionner une période" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matin">Matin</SelectItem>
                  <SelectItem value="apres_midi">Après-midi</SelectItem>
                  <SelectItem value="toute_journee">Journée complète</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Dates</Label>
              <Calendar
                mode="multiple"
                selected={selectedDates}
                onSelect={(dates) => {
                  if (dates) {
                    const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());
                    setSelectedDates(sortedDates);
                  }
                }}
                locale={fr}
                className="rounded-md border"
              />
              
              {selectedDates.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedDates.map((date) => (
                    <Badge
                      key={format(date, 'yyyy-MM-dd')}
                      variant="secondary"
                      className="gap-1"
                    >
                      {format(date, 'dd/MM/yyyy', { locale: fr })}
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() => handleRemoveDate(date)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
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
