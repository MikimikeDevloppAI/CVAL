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

interface Site {
  id: string;
  nom: string;
}

interface QuickEditSitesDialogProps {
  secretaireId: string;
  sitesActuels: string[];
  sitesActuelsDetails: { nom: string }[];
  onSuccess: () => void;
}

export function QuickEditSitesDialog({ 
  secretaireId, 
  sitesActuels, 
  sitesActuelsDetails,
  onSuccess 
}: QuickEditSitesDialogProps) {
  const [open, setOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSites, setSelectedSites] = useState<string[]>(sitesActuels);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchSites = async () => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      if (error) {
        console.error('Erreur lors du chargement des sites:', error);
        return;
      }

      setSites(data || []);
    };

    fetchSites();
  }, []);

  useEffect(() => {
    setSelectedSites(sitesActuels);
  }, [sitesActuels]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('secretaires')
        .update({ sites_assignes: selectedSites })
        .eq('id', secretaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Sites assignés mis à jour avec succès",
      });

      setOpen(false);
      onSuccess();
    } catch (error) {
      console.error('Erreur lors de la mise à jour:', error);
      toast({
        title: "Erreur",
        description: "Impossible de mettre à jour les sites assignés",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSite = (siteId: string) => {
    setSelectedSites(prev => 
      prev.includes(siteId)
        ? prev.filter(id => id !== siteId)
        : [...prev, siteId]
    );
  };

  const selectedSitesDetails = sites.filter(site => selectedSites.includes(site.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs opacity-60 hover:opacity-100 transition-opacity"
        >
          <Plus className="h-3 w-3 mr-1" />
          Modifier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Modifier les sites assignés</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Sites assignés ({selectedSites.length})
            </label>
            
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selectedSites.length > 0
                    ? `${selectedSites.length} site(s) sélectionné(s)`
                    : "Sélectionner des sites"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput placeholder="Rechercher un site..." />
                  <CommandList className="max-h-64">
                    <CommandEmpty>Aucun site trouvé.</CommandEmpty>
                    <CommandGroup>
                      {sites.map((site) => (
                        <CommandItem
                          key={site.id}
                          onSelect={() => toggleSite(site.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedSites.includes(site.id)
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          {site.nom}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {selectedSitesDetails.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 bg-muted/20 rounded-md">
              {selectedSitesDetails.map((site) => (
                <Badge key={site.id} variant="secondary" className="text-xs">
                  {site.nom}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
