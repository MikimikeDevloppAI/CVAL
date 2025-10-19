import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Medecin {
  id: string;
  first_name: string;
  name: string;
}

interface QuickEditMedecinDialogProps {
  secretaireId: string;
  medecinsActuelsDetails: { first_name: string; name: string; priorite?: string }[];
  onSuccess: () => void;
}

export function QuickEditMedecinDialog({ 
  secretaireId, 
  medecinsActuelsDetails,
  onSuccess 
}: QuickEditMedecinDialogProps) {
  const [open, setOpen] = useState(false);
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [selectedMedecinsPrio1, setSelectedMedecinsPrio1] = useState<string[]>([]);
  const [selectedMedecinsPrio2, setSelectedMedecinsPrio2] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      // Fetch available medecins
      const { data: medecinsData, error: medecinsError } = await supabase
        .from('medecins')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');

      if (medecinsError) {
        console.error('Erreur lors du chargement des médecins:', medecinsError);
        return;
      }

      setMedecins(medecinsData || []);

      // Fetch current medecin assignments with priorities
      const { data: secretairesMedecinsData } = await supabase
        .from('secretaires_medecins')
        .select('medecin_id, priorite')
        .eq('secretaire_id', secretaireId);

      if (secretairesMedecinsData) {
        const prio1 = secretairesMedecinsData
          .filter(sm => sm.priorite === '1')
          .map(sm => sm.medecin_id);
        const prio2 = secretairesMedecinsData
          .filter(sm => sm.priorite === '2')
          .map(sm => sm.medecin_id);
        
        setSelectedMedecinsPrio1(prio1);
        setSelectedMedecinsPrio2(prio2);
      }
    };

    if (open) {
      fetchData();
    }
  }, [secretaireId, open]);

  const handleSave = async () => {
    setLoading(true);
    try {
      // Delete existing assignments
      await supabase
        .from('secretaires_medecins')
        .delete()
        .eq('secretaire_id', secretaireId);

      // Insert new assignments with priorities
      const medecinsData = [
        ...selectedMedecinsPrio1.map(medecinId => ({
          secretaire_id: secretaireId,
          medecin_id: medecinId,
          priorite: '1' as '1' | '2'
        })),
        ...selectedMedecinsPrio2.map(medecinId => ({
          secretaire_id: secretaireId,
          medecin_id: medecinId,
          priorite: '2' as '1' | '2'
        }))
      ];

      if (medecinsData.length > 0) {
        const { error } = await supabase
          .from('secretaires_medecins')
          .insert(medecinsData);

        if (error) throw error;
      }

      toast({
        title: "Succès",
        description: "Médecins assignés mis à jour avec succès",
      });

      setOpen(false);
      onSuccess();
    } catch (error) {
      console.error('Erreur lors de la mise à jour:', error);
      toast({
        title: "Erreur",
        description: "Impossible de mettre à jour les médecins assignés",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleMedecinPrio1 = (medecinId: string) => {
    setSelectedMedecinsPrio1(prev => 
      prev.includes(medecinId)
        ? prev.filter(id => id !== medecinId)
        : [...prev, medecinId]
    );
    // Remove from prio2 if present
    setSelectedMedecinsPrio2(prev => prev.filter(id => id !== medecinId));
  };

  const toggleMedecinPrio2 = (medecinId: string) => {
    setSelectedMedecinsPrio2(prev => 
      prev.includes(medecinId)
        ? prev.filter(id => id !== medecinId)
        : [...prev, medecinId]
    );
    // Remove from prio1 if present
    setSelectedMedecinsPrio1(prev => prev.filter(id => id !== medecinId));
  };

  const selectedMedecinsDetailsPrio1 = medecins.filter(medecin => selectedMedecinsPrio1.includes(medecin.id));
  const selectedMedecinsDetailsPrio2 = medecins.filter(medecin => selectedMedecinsPrio2.includes(medecin.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs hover:bg-cyan-500/10 hover:text-cyan-600 transition-colors"
        >
          <Plus className="h-3 w-3 mr-1" />
          Modifier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-cyan-500 to-teal-600 bg-clip-text text-transparent">
            Modifier les médecins assignés
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Médecins Priorité 1 */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Médecins priorité 1 ({selectedMedecinsPrio1.length})
            </label>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selectedMedecinsPrio1.length > 0
                    ? `${selectedMedecinsPrio1.length} médecin(s) prioritaire(s)`
                    : "Sélectionner des médecins prioritaires"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput placeholder="Rechercher un médecin..." />
                  <CommandList className="max-h-64">
                    <CommandEmpty>Aucun médecin trouvé.</CommandEmpty>
                    <CommandGroup>
                      {medecins.map((medecin) => (
                        <CommandItem
                          key={medecin.id}
                          onSelect={() => toggleMedecinPrio1(medecin.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedMedecinsPrio1.includes(medecin.id)
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          {medecin.first_name} {medecin.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {selectedMedecinsDetailsPrio1.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 bg-cyan-500/5 border border-cyan-200/20 dark:border-cyan-800/20 rounded-lg mt-2">
                {selectedMedecinsDetailsPrio1.map((medecin) => (
                  <Badge key={medecin.id} className="bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 border-cyan-500/20 text-xs">
                    {medecin.first_name} {medecin.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Médecins Priorité 2 */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Médecins priorité 2 ({selectedMedecinsPrio2.length})
            </label>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selectedMedecinsPrio2.length > 0
                    ? `${selectedMedecinsPrio2.length} médecin(s) secondaire(s)`
                    : "Sélectionner des médecins secondaires"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput placeholder="Rechercher un médecin..." />
                  <CommandList className="max-h-64">
                    <CommandEmpty>Aucun médecin trouvé.</CommandEmpty>
                    <CommandGroup>
                      {medecins.map((medecin) => (
                        <CommandItem
                          key={medecin.id}
                          onSelect={() => toggleMedecinPrio2(medecin.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedMedecinsPrio2.includes(medecin.id)
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          {medecin.first_name} {medecin.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {selectedMedecinsDetailsPrio2.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 bg-cyan-500/5 border border-cyan-200/20 dark:border-cyan-800/20 rounded-lg mt-2">
                {selectedMedecinsDetailsPrio2.map((medecin) => (
                  <Badge key={medecin.id} variant="outline" className="text-xs bg-cyan-50 dark:bg-cyan-950/20 border-cyan-200 dark:border-cyan-900">
                    {medecin.first_name} {medecin.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600"
            >
              {loading ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
