import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Check, ChevronsUpDown, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Medecin {
  id: string;
  first_name: string;
  name: string;
  existing_assignment?: string;
}

interface AddMedecinToDayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  siteId: string;
  onSuccess: () => void;
}

export function AddMedecinToDayDialog({
  open,
  onOpenChange,
  date,
  siteId,
  onSuccess,
}: AddMedecinToDayDialogProps) {
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [selectedMedecinId, setSelectedMedecinId] = useState('');
  const [periode, setPeriode] = useState<'matin' | 'apres_midi' | 'journee'>('matin');
  const [loading, setLoading] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [existingAssignment, setExistingAssignment] = useState<any>(null);

  useEffect(() => {
    if (open) {
      fetchMedecins();
      setSelectedMedecinId('');
      setPeriode('matin');
    }
  }, [open]);

  useEffect(() => {
    if (periode && open) {
      setSelectedMedecinId(''); // Reset selection when period changes
      fetchMedecins();
    }
  }, [periode, open]);

  useEffect(() => {
    if (selectedMedecinId) {
      checkExistingAssignment();
    } else {
      setExistingAssignment(null);
    }
  }, [selectedMedecinId, date]);

  const fetchMedecins = async () => {
    const { data } = await supabase
      .from('medecins')
      .select('id, first_name, name')
      .eq('actif', true)
      .order('name');

    if (data) {
      // Détermine les périodes à vérifier selon la sélection
      const periodsToCheck: ('matin' | 'apres_midi')[] = periode === 'journee' 
        ? ['matin', 'apres_midi'] 
        : [periode as 'matin' | 'apres_midi'];

      // Fetch existing assignments for the selected period(s)
      const { data: besoinsData } = await supabase
        .from('besoin_effectif')
        .select('medecin_id, demi_journee')
        .eq('date', date)
        .eq('type', 'medecin')
        .in('demi_journee', periodsToCheck);

      // Filter to only include medecins who are available for the selected period
      const medecinsFiltered = data.filter(med => {
        if (periode === 'journee') {
          // Pour journée complète, le médecin ne doit avoir aucune affectation (ni matin ni après-midi)
          const hasMatin = besoinsData?.some(b => b.medecin_id === med.id && b.demi_journee === 'matin');
          const hasApresMidi = besoinsData?.some(b => b.medecin_id === med.id && b.demi_journee === 'apres_midi');
          return !hasMatin && !hasApresMidi;
        } else {
          // Pour une demi-journée spécifique, vérifier seulement cette période
          const hasPeriod = besoinsData?.some(b => b.medecin_id === med.id && b.demi_journee === periode);
          return !hasPeriod;
        }
      });

      setMedecins(medecinsFiltered.map(m => ({
        id: m.id,
        first_name: m.first_name,
        name: m.name,
        existing_assignment: ''
      })));
    }
  };

  const checkExistingAssignment = async () => {
    // Check which periods are available for this medecin
    const periodsToCheck: ('matin' | 'apres_midi')[] = periode === 'journee' 
      ? ['matin', 'apres_midi'] 
      : [periode as 'matin' | 'apres_midi'];

    const { data } = await supabase
      .from('besoin_effectif')
      .select('demi_journee')
      .eq('medecin_id', selectedMedecinId)
      .eq('date', date)
      .eq('type', 'medecin')
      .in('demi_journee', periodsToCheck);

    setExistingAssignment(data && data.length > 0 ? data : null);
  };

  const handleSubmit = async () => {
    if (!selectedMedecinId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un médecin',
        variant: 'destructive',
      });
      return;
    }

    if (existingAssignment && existingAssignment.length > 0) {
      toast({
        title: 'Erreur',
        description: 'Ce médecin a déjà une assignation pour cette période',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Create entries only for available periods
      const entries: Array<{ demi_journee: 'matin' | 'apres_midi' }> = periode === 'journee'
        ? [{ demi_journee: 'matin' }, { demi_journee: 'apres_midi' }]
        : [{ demi_journee: periode as 'matin' | 'apres_midi' }];

      for (const entry of entries) {
        const { error } = await supabase
          .from('besoin_effectif')
          .insert([{
            date,
            medecin_id: selectedMedecinId,
            site_id: siteId,
            type: 'medecin',
            demi_journee: entry.demi_journee,
            actif: true,
          }]);

        if (error) throw error;
      }

      toast({
        title: 'Succès',
        description: 'Médecin ajouté avec succès',
      });

      onSuccess();
      setSelectedMedecinId('');
      setPeriode('matin');
    } catch (error) {
      console.error('Error adding medecin:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'ajouter le médecin',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedMedecin = medecins.find(m => m.id === selectedMedecinId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-primary">
            Ajouter un médecin
          </DialogTitle>
          <DialogDescription>
            Sélectionnez un médecin et la période pour ce jour
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Période d'abord */}
          <div className="space-y-2">
            <Label>Période</Label>
            <RadioGroup value={periode} onValueChange={(v: any) => setPeriode(v)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="matin" id="matin" />
                <Label htmlFor="matin" className="font-normal cursor-pointer">
                  Matin
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="apres_midi" id="apres_midi" />
                <Label htmlFor="apres_midi" className="font-normal cursor-pointer">
                  Après-midi
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="journee" id="journee" />
                <Label htmlFor="journee" className="font-normal cursor-pointer">
                  Journée complète
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Médecin ensuite */}
          <div className="space-y-2">
            <Label>Médecin disponible pour cette période</Label>
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboOpen}
                  className="w-full justify-between"
                >
                  {selectedMedecin
                    ? `${selectedMedecin.first_name} ${selectedMedecin.name}`
                    : "Sélectionner un médecin..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 z-50" style={{ backgroundColor: 'hsl(var(--background))' }}>
                <Command>
                  <CommandInput placeholder="Rechercher un médecin..." />
                  <CommandEmpty>Aucun médecin disponible pour cette période.</CommandEmpty>
                  <CommandGroup className="max-h-[300px] overflow-y-auto">
                    {medecins.map((medecin) => (
                      <CommandItem
                        key={medecin.id}
                        value={`${medecin.first_name} ${medecin.name}`}
                        onSelect={() => {
                          setSelectedMedecinId(medecin.id);
                          setComboOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 flex-shrink-0",
                            selectedMedecinId === medecin.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="truncate">{medecin.first_name} {medecin.name}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>

            {existingAssignment && existingAssignment.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Ce médecin a déjà une assignation pour cette période. Veuillez choisir une autre période.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !selectedMedecinId}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ajouter
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
