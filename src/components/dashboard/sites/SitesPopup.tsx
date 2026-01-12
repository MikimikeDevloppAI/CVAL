import { useState, useEffect } from 'react';
import { Plus, Search, Building } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SiteCard } from './SiteCard';
import { SiteForm } from './SiteForm';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface Site {
  id: string;
  nom: string;
  adresse: string;
  fermeture?: boolean;
  actif?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface SitesPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  embedded?: boolean;
}

export function SitesPopup({ open, onOpenChange, embedded = false }: SitesPopupProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const { canManage } = useCanManagePlanning();

  const fetchSites = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('sites')
        .select('*')
        .order('nom', { ascending: true });

      if (error) throw error;
      setSites(data || []);
    } catch (error) {
      console.error('Erreur lors de la récupération des sites:', error);
      toast.error('Erreur lors de la récupération des sites');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open || embedded) {
      fetchSites();
    }
  }, [open, embedded]);

  const filteredSites = sites.filter(site => {
    const matchesSearch = site.nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         site.adresse?.toLowerCase().includes(searchTerm.toLowerCase());

    // Exclure les sites administratif et bloc opératoire
    const isExcludedSite = site.nom.toLowerCase().includes('administratif') ||
                          site.nom.toLowerCase().includes('bloc opératoire');

    const matchesStatus = showInactive ? site.actif === false : site.actif !== false;

    return matchesSearch && matchesStatus && !isExcludedSite;
  });

  const handleFormSuccess = () => {
    setShowForm(false);
    fetchSites();
  };

  const handleCloseDialog = () => {
    setShowForm(false);
    setSearchTerm('');
    onOpenChange(false);
  };

  const handleAdd = () => {
    setShowForm(true);
  };

  const handleBack = () => {
    setShowForm(false);
  };

  if (embedded) {
    return (
      <>
        <div className="bg-card/50 backdrop-blur-xl border border-border/50 shadow-xl rounded-2xl p-6 h-[calc(100vh-48px)] flex flex-col">
          <h1 className="text-2xl font-bold mb-6 shrink-0">Gestion des Sites</h1>

          {showForm ? (
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-xl">
                <SiteForm site={null} onSuccess={handleFormSuccess} onBack={handleBack} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Search and Actions - Fixed */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 mb-6 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher un site..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 h-11 rounded-xl border-border/50 bg-background/50 focus:bg-background transition-colors"
                  />
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50">
                    <Switch
                      checked={showInactive}
                      onCheckedChange={setShowInactive}
                      id="show-inactive-sites-embedded"
                      className="scale-90"
                    />
                    <label htmlFor="show-inactive-sites-embedded" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                      Inactifs
                    </label>
                  </div>

                  {canManage && (
                    <PrimaryButton onClick={handleAdd}>
                      <Plus className="h-4 w-4" />
                      <span className="hidden sm:inline">Ajouter</span>
                    </PrimaryButton>
                  )}
                </div>
              </div>

              {/* Scrollable List */}
              <div className="flex-1 overflow-y-auto overflow-x-visible min-h-0 -mx-2 px-2 pt-2 pb-2">
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm font-medium">Chargement...</span>
                    </div>
                  </div>
                ) : filteredSites.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500/10 to-emerald-500/10 flex items-center justify-center mb-5">
                      <Building className="w-10 h-10 text-teal-600/60 dark:text-teal-400/60" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">Aucun site trouvé</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      {searchTerm
                        ? 'Essayez de modifier vos critères de recherche'
                        : showInactive
                          ? 'Aucun site inactif'
                          : 'Commencez par ajouter un site'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-fade-in">
                    {filteredSites.map((site, index) => (
                      <SiteCard
                        key={site.id}
                        site={site}
                        index={index}
                        onUpdate={fetchSites}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-4 pb-3 border-b border-border/50">
            <DialogTitle className="text-2xl font-bold">
              Gestion des Sites
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
            {showForm ? (
              <div className="max-w-xl mx-auto">
                <SiteForm site={null} onSuccess={handleFormSuccess} onBack={handleBack} />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Search and Actions */}
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher un site..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 h-11 rounded-xl border-border/50 bg-background/50 focus:bg-background transition-colors"
                    />
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50">
                      <Switch
                        checked={showInactive}
                        onCheckedChange={setShowInactive}
                        id="show-inactive-sites-popup"
                        className="scale-90"
                      />
                      <label htmlFor="show-inactive-sites-popup" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                        Inactifs
                      </label>
                    </div>

                    {canManage && (
                      <PrimaryButton onClick={handleAdd}>
                        <Plus className="h-4 w-4" />
                        <span className="hidden sm:inline">Ajouter</span>
                      </PrimaryButton>
                    )}
                  </div>
                </div>

                {/* List */}
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm font-medium">Chargement...</span>
                    </div>
                  </div>
                ) : filteredSites.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500/10 to-emerald-500/10 flex items-center justify-center mb-5">
                      <Building className="w-10 h-10 text-teal-600/60 dark:text-teal-400/60" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">Aucun site trouvé</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      {searchTerm
                        ? 'Essayez de modifier vos critères de recherche'
                        : showInactive
                          ? 'Aucun site inactif'
                          : 'Commencez par ajouter un site'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-fade-in">
                    {filteredSites.map((site, index) => (
                      <SiteCard
                        key={site.id}
                        site={site}
                        index={index}
                        onUpdate={fetchSites}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
