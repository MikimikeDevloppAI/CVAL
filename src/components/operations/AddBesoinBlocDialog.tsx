import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Medecin {
  id: string;
  first_name: string;
  name: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
}

interface AddBesoinBlocDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const AddBesoinBlocDialog = ({
  open,
  onOpenChange,
  onSuccess,
}: AddBesoinBlocDialogProps) => {
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [selectedMedecin, setSelectedMedecin] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedPeriode, setSelectedPeriode] = useState<'matin' | 'apres_midi'>('matin');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedMedecin('');
      setSelectedType('');
      setSelectedDate(undefined);
      setSelectedPeriode('matin');
    }
  }, [open]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch active medecins
      const { data: medecinData, error: medecinError } = await supabase
        .from('medecins')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('name');

      if (medecinError) throw medecinError;
      setMedecins(medecinData || []);

      // Fetch active types intervention
      const { data: typeData, error: typeError } = await supabase
        .from('types_intervention')
        .select('id, nom, code')
        .eq('actif', true)
        .order('nom');

      if (typeError) throw typeError;
      setTypesIntervention(typeData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedMedecin || !selectedType || !selectedDate) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      setSubmitting(true);
      const dateStr = format(selectedDate, 'yyyy-MM-dd');

      // Check if a besoin already exists for this medecin on this date/periode
      const { data: existingBesoin, error: checkError } = await supabase
        .from('besoin_effectif')
        .select('id')
        .eq('medecin_id', selectedMedecin)
        .eq('date', dateStr)
        .eq('demi_journee', selectedPeriode)
        .eq('type', 'bloc_operatoire')
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      if (existingBesoin) {
        // Update existing besoin
        const { error: updateError } = await supabase
          .from('besoin_effectif')
          .update({
            type_intervention_id: selectedType,
            actif: true
          })
          .eq('id', existingBesoin.id);

        if (updateError) throw updateError;
        toast.success('Besoin mis à jour avec succès');
      } else {
        // Create new besoin
        const { data: blocSite, error: siteError } = await supabase
          .from('sites')
          .select('id')
          .eq('nom', 'Clinique La Vallée - Bloc opératoire')
          .single();

        if (siteError) throw siteError;

        const { error: insertError } = await supabase
          .from('besoin_effectif')
          .insert({
            date: dateStr,
            demi_journee: selectedPeriode,
            medecin_id: selectedMedecin,
            type_intervention_id: selectedType,
            site_id: blocSite.id,
            type: 'bloc_operatoire',
            actif: true
          });

        if (insertError) throw insertError;
        toast.success('Besoin créé avec succès');
      }

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating besoin:', error);
      toast.error('Erreur lors de la création du besoin');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajouter un besoin de bloc</DialogTitle>
          <DialogDescription>
            Créer un nouveau besoin d'opération pour le bloc opératoire
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Date Selector */}
              <div className="space-y-2">
                <Label>Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !selectedDate && 'text-muted-foreground'
                      )}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {selectedDate ? (
                        format(selectedDate, 'PPP', { locale: fr })
                      ) : (
                        'Sélectionner une date'
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      locale={fr}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Periode Selector */}
              <div className="space-y-2">
                <Label>Période</Label>
                <Select value={selectedPeriode} onValueChange={(value: any) => setSelectedPeriode(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="matin">Matin</SelectItem>
                    <SelectItem value="apres_midi">Après-midi</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Medecin Selector */}
              <div className="space-y-2">
                <Label>Médecin</Label>
                <Select value={selectedMedecin} onValueChange={setSelectedMedecin}>
                  <SelectTrigger>
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

              {/* Type Intervention Selector */}
              <div className="space-y-2">
                <Label>Type d'intervention</Label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un type" />
                  </SelectTrigger>
                  <SelectContent>
                    {typesIntervention.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.nom} ({type.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedMedecin || !selectedType || !selectedDate || submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
