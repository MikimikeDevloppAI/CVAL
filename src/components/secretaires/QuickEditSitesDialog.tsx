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
  sitesActuelsDetails: { nom: string; priorite?: string }[];
  onSuccess: () => void;
}

export function QuickEditSitesDialog({ 
  secretaireId, 
  sitesActuelsDetails,
  onSuccess 
}: QuickEditSitesDialogProps) {
  const [open, setOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSitesPrio1, setSelectedSitesPrio1] = useState<string[]>([]);
  const [selectedSitesPrio2, setSelectedSitesPrio2] = useState<string[]>([]);
  const [selectedSitesPrio3, setSelectedSitesPrio3] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      // Fetch available sites
      const { data: sitesData, error: sitesError } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .not('nom', 'ilike', '%bloc opératoire%')
        .order('nom');

      if (sitesError) {
        console.error('Erreur lors du chargement des sites:', sitesError);
        return;
      }

      setSites(sitesData || []);

      // Fetch current site assignments with priorities
      const { data: secretairesSitesData } = await supabase
        .from('secretaires_sites')
        .select('site_id, priorite')
        .eq('secretaire_id', secretaireId);

      if (secretairesSitesData) {
        const prio1 = secretairesSitesData
          .filter(ss => ss.priorite === '1')
          .map(ss => ss.site_id);
        const prio2 = secretairesSitesData
          .filter(ss => ss.priorite === '2')
          .map(ss => ss.site_id);
        const prio3 = secretairesSitesData
          .filter(ss => ss.priorite === '3')
          .map(ss => ss.site_id);
        
        setSelectedSitesPrio1(prio1);
        setSelectedSitesPrio2(prio2);
        setSelectedSitesPrio3(prio3);
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
        .from('secretaires_sites')
        .delete()
        .eq('secretaire_id', secretaireId);

      // Insert new assignments with priorities
      const sitesData = [
        ...selectedSitesPrio1.map(siteId => ({
          secretaire_id: secretaireId,
          site_id: siteId,
          priorite: '1' as '1' | '2' | '3'
        })),
        ...selectedSitesPrio2.map(siteId => ({
          secretaire_id: secretaireId,
          site_id: siteId,
          priorite: '2' as '1' | '2' | '3'
        })),
        ...selectedSitesPrio3.map(siteId => ({
          secretaire_id: secretaireId,
          site_id: siteId,
          priorite: '3' as '1' | '2' | '3'
        }))
      ];

      if (sitesData.length > 0) {
        const { error } = await supabase
          .from('secretaires_sites')
          .insert(sitesData);

        if (error) throw error;
      }

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

  const toggleSitePrio1 = (siteId: string) => {
    setSelectedSitesPrio1(prev => 
      prev.includes(siteId)
        ? prev.filter(id => id !== siteId)
        : [...prev, siteId]
    );
    // Remove from prio2 and prio3 if present
    setSelectedSitesPrio2(prev => prev.filter(id => id !== siteId));
    setSelectedSitesPrio3(prev => prev.filter(id => id !== siteId));
  };

  const toggleSitePrio2 = (siteId: string) => {
    setSelectedSitesPrio2(prev => 
      prev.includes(siteId)
        ? prev.filter(id => id !== siteId)
        : [...prev, siteId]
    );
    // Remove from prio1 and prio3 if present
    setSelectedSitesPrio1(prev => prev.filter(id => id !== siteId));
    setSelectedSitesPrio3(prev => prev.filter(id => id !== siteId));
  };

  const toggleSitePrio3 = (siteId: string) => {
    setSelectedSitesPrio3(prev => 
      prev.includes(siteId)
        ? prev.filter(id => id !== siteId)
        : [...prev, siteId]
    );
    // Remove from prio1 and prio2 if present
    setSelectedSitesPrio1(prev => prev.filter(id => id !== siteId));
    setSelectedSitesPrio2(prev => prev.filter(id => id !== siteId));
  };

  const allSelectedSites = [...selectedSitesPrio1, ...selectedSitesPrio2, ...selectedSitesPrio3];
  const selectedSitesDetailsPrio1 = sites.filter(site => selectedSitesPrio1.includes(site.id));
  const selectedSitesDetailsPrio2 = sites.filter(site => selectedSitesPrio2.includes(site.id));
  const selectedSitesDetailsPrio3 = sites.filter(site => selectedSitesPrio3.includes(site.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs hover:bg-teal-500/10 hover:text-teal-600 transition-colors"
        >
          <Plus className="h-3 w-3 mr-1" />
          Modifier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-teal-500 to-cyan-600 bg-clip-text text-transparent">
            Modifier les sites assignés
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Sites Priorité 1 */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Sites priorité 1 ({selectedSitesPrio1.length})
            </label>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selectedSitesPrio1.length > 0
                    ? `${selectedSitesPrio1.length} site(s) prioritaire(s)`
                    : "Sélectionner des sites prioritaires"}
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
                          onSelect={() => toggleSitePrio1(site.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedSitesPrio1.includes(site.id)
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

            {selectedSitesDetailsPrio1.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 bg-muted/20 rounded-md mt-2">
                {selectedSitesDetailsPrio1.map((site) => (
                  <Badge key={site.id} variant="secondary" className="text-xs">
                    {site.nom}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Sites Priorité 2 */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Sites priorité 2 ({selectedSitesPrio2.length})
            </label>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selectedSitesPrio2.length > 0
                    ? `${selectedSitesPrio2.length} site(s) secondaire(s)`
                    : "Sélectionner des sites secondaires"}
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
                          onSelect={() => toggleSitePrio2(site.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedSitesPrio2.includes(site.id)
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

            {selectedSitesDetailsPrio2.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 bg-muted/20 rounded-md mt-2">
                {selectedSitesDetailsPrio2.map((site) => (
                  <Badge key={site.id} variant="outline" className="text-xs">
                    {site.nom}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Sites Priorité 3 */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Sites priorité 3 ({selectedSitesPrio3.length})
            </label>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selectedSitesPrio3.length > 0
                    ? `${selectedSitesPrio3.length} site(s) tertiaire(s)`
                    : "Sélectionner des sites tertiaires"}
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
                          onSelect={() => toggleSitePrio3(site.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedSitesPrio3.includes(site.id)
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

            {selectedSitesDetailsPrio3.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 bg-muted/20 rounded-md mt-2">
                {selectedSitesDetailsPrio3.map((site) => (
                  <Badge key={site.id} variant="outline" className="text-xs opacity-70">
                    {site.nom}
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
              className="bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600"
            >
              {loading ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
