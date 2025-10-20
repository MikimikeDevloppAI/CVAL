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
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Medecin {
  id: string;
  first_name: string;
  name: string;
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

  useEffect(() => {
    if (open) {
      fetchMedecins();
    }
  }, [open]);

  const fetchMedecins = async () => {
    const { data } = await supabase
      .from('medecins')
      .select('id, first_name, name')
      .eq('actif', true)
      .order('name');

    if (data) {
      setMedecins(data);
    }
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

    setLoading(true);
    try {
      // Check if already assigned
      const { data: existing } = await supabase
        .from('besoin_effectif')
        .select('id')
        .eq('medecin_id', selectedMedecinId)
        .eq('date', date)
        .eq('site_id', siteId)
        .eq('type', 'medecin');

      if (existing && existing.length > 0) {
        toast({
          title: 'Attention',
          description: 'Ce médecin est déjà assigné pour ce jour',
          variant: 'destructive',
        });
        return;
      }

      // Create entries
      const entries = periode === 'journee'
        ? [{ demi_journee: 'matin' }, { demi_journee: 'apres_midi' }]
        : [{ demi_journee: periode }];

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
          <DialogTitle className="bg-gradient-to-r from-cyan-500 to-teal-600 bg-clip-text text-transparent">
            Ajouter un médecin
          </DialogTitle>
          <DialogDescription>
            Sélectionnez un médecin et la période pour ce jour
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Médecin</Label>
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
              <PopoverContent className="w-full p-0">
                <Command>
                  <CommandInput placeholder="Rechercher un médecin..." />
                  <CommandEmpty>Aucun médecin trouvé.</CommandEmpty>
                  <CommandGroup>
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
                            "mr-2 h-4 w-4",
                            selectedMedecinId === medecin.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {medecin.first_name} {medecin.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

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
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !selectedMedecinId}
            className="bg-gradient-to-r from-cyan-500 to-teal-600"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ajouter
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
