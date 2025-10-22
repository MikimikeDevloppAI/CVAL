import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, CalendarIcon, X } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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

interface AddBesoinOperationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const BLOC_OPERATOIRE_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';

export const AddBesoinOperationDialog = ({
  open,
  onOpenChange,
  onSuccess
}: AddBesoinOperationDialogProps) => {
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');
  const [selectedMedecinId, setSelectedMedecinId] = useState<string>('');
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedPeriode, setSelectedPeriode] = useState<'matin' | 'apres_midi' | ''>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
      resetForm();
    }
  }, [open]);

  const resetForm = () => {
    setSelectedTypeInterventionId('');
    setSelectedMedecinId('');
    setSelectedDates([]);
    setSelectedPeriode('');
    setShowCalendar(false);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [{ data: typesData, error: typesError }, { data: medecinsData, error: medecinsError }] = await Promise.all([
        supabase
          .from('types_intervention')
          .select('id, nom, code')
          .eq('actif', true)
          .order('nom'),
        supabase
          .from('medecins')
          .select('id, first_name, name')
          .eq('actif', true)
          .order('name')
      ]);

      if (typesError) throw typesError;
      if (medecinsError) throw medecinsError;

      setTypesIntervention(typesData || []);
      setMedecins(medecinsData || []);
    } catch (error: any) {
      console.error('Erreur lors du chargement des données:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const handleDateSelect = (dates: Date[] | undefined) => {
    if (dates) {
      setSelectedDates(dates);
    }
  };

  const removeDate = (dateToRemove: Date) => {
    setSelectedDates(prev => prev.filter(d => d.getTime() !== dateToRemove.getTime()));
  };

  const handleSubmit = async () => {
    if (!selectedTypeInterventionId || !selectedMedecinId || selectedDates.length === 0 || !selectedPeriode) {
      toast.error('Veuillez remplir tous les champs et sélectionner au moins un jour');
      return;
    }

    setSubmitting(true);
    try {
      // Create besoins for all selected dates
      const besoinsToCreate = selectedDates.map(date => ({
        date: format(date, 'yyyy-MM-dd'),
        demi_journee: selectedPeriode,
        medecin_id: selectedMedecinId,
        site_id: BLOC_OPERATOIRE_SITE_ID,
        type: 'medecin' as const,
        type_intervention_id: selectedTypeInterventionId,
        actif: true
      }));

      const { error: insertError } = await supabase
        .from('besoin_effectif')
        .insert(besoinsToCreate);

      if (insertError) throw insertError;

      toast.success(`${selectedDates.length} besoin(s) d'opération ajouté(s) avec succès`);
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Erreur lors de l\'ajout des besoins:', error);
      toast.error('Erreur lors de l\'ajout des besoins: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter des besoins d'opération</DialogTitle>
          <DialogDescription>
            Créer des besoins d'opération pour plusieurs jours
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Sélection des dates */}
            <div className="space-y-2">
              <Label>Jours *</Label>
              <div className="space-y-2">
                {selectedDates.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-3 bg-muted/30 rounded-lg">
                    {selectedDates.map((date, index) => (
                      <Badge key={index} variant="secondary" className="gap-1">
                        {format(date, 'EEE d MMM', { locale: fr })}
                        <button
                          type="button"
                          onClick={() => removeDate(date)}
                          className="ml-1 hover:bg-destructive/20 rounded-full"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setShowCalendar(!showCalendar)}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDates.length === 0 
                    ? 'Sélectionner des jours' 
                    : `${selectedDates.length} jour(s) sélectionné(s)`
                  }
                </Button>

                {showCalendar && (
                  <div className="border rounded-lg p-3 bg-background">
                    <Calendar
                      mode="multiple"
                      selected={selectedDates}
                      onSelect={handleDateSelect}
                      locale={fr}
                      className={cn("pointer-events-auto")}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type-intervention">Type d'intervention *</Label>
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
              <Label htmlFor="medecin">Médecin *</Label>
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
              <Label htmlFor="periode">Période *</Label>
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
          <Button onClick={handleSubmit} disabled={loading || submitting || selectedDates.length === 0}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? 'Ajout...' : `Ajouter ${selectedDates.length > 0 ? `(${selectedDates.length})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
