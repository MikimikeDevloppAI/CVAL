import { useState, useEffect } from 'react';
import { Plus, Search, Building, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ModernCard } from '@/components/ui/modern-card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SiteForm } from './SiteForm';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
}

export function SitesPopup({ open, onOpenChange }: SitesPopupProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [siteToToggle, setSiteToToggle] = useState<Site | null>(null);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
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
    if (open) {
      fetchSites();
    }
  }, [open]);

  const handleToggleActif = async (site: Site) => {
    if (site.actif) {
      setSiteToToggle(site);
      setShowDeactivateDialog(true);
    } else {
      await performToggle(site);
    }
  };

  const performToggle = async (site: Site) => {
    try {
      const { error } = await supabase
        .from('sites')
        .update({ actif: !site.actif })
        .eq('id', site.id);

      if (error) throw error;

      toast.success(
        site.actif 
          ? 'Site désactivé avec succès' 
          : 'Site activé avec succès'
      );
      
      await fetchSites();
    } catch (error) {
      console.error('Erreur lors de la mise à jour du site:', error);
      toast.error('Erreur lors de la mise à jour du site');
    }
  };

  const filteredSites = sites.filter(site => {
    const matchesSearch = site.nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         site.adresse?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Exclure les sites administratif et bloc opératoire
    const isExcludedSite = site.nom.toLowerCase().includes('administratif') || 
                          site.nom.toLowerCase().includes('bloc opératoire');
    
    // Ne montrer que les sites actifs et non exclus
    return matchesSearch && site.actif && !isExcludedSite;
  });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedSite(null);
    fetchSites();
  };

  const handleCloseDialog = () => {
    setSearchTerm('');
    onOpenChange(false);
  };

  const handleAdd = () => {
    setSelectedSite(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (site: Site) => {
    setSelectedSite(site);
    setIsDialogOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-4 pb-3 border-b border-border/50">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-violet-500 to-purple-500 bg-clip-text text-transparent">
              Gestion des Sites
            </DialogTitle>
          </DialogHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
            <div className="space-y-6">
              {/* Search and Actions */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-600 dark:text-violet-400" />
                  <Input
                    placeholder="Rechercher un site..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 border-violet-200/50 focus:border-violet-500"
                  />
                </div>
                
                {canManage && (
                  <Button
                    onClick={handleAdd}
                    size="default"
                    className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter un site
                  </Button>
                )}
              </div>

              {/* Sites Grid */}
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-violet-500 border-r-transparent"></div>
                    <p className="mt-2 text-sm text-muted-foreground">Chargement des sites...</p>
                  </div>
                </div>
              ) : filteredSites.length === 0 ? (
                <div className="text-center py-12">
                  <Building className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {searchTerm ? 'Aucun site trouvé pour cette recherche' : 'Aucun site disponible'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredSites.map((site) => (
                    <ModernCard
                      key={site.id}
                      className="group hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 overflow-hidden"
                    >
                      <div className="space-y-6 p-6">
                        {/* Site Header avec gradient background */}
                        <div className="flex items-start gap-4">
                          <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-lg">
                            <Building className="h-6 w-6 text-white" />
                          </div>
                          <div className="space-y-2 flex-1 min-w-0">
                            <h3 className="font-bold text-xl group-hover:text-violet-500 transition-colors leading-tight">
                              {site.nom}
                            </h3>
                            {site.adresse && (
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                {site.adresse}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Badges */}
                        {site.fermeture && (
                          <div className="flex flex-wrap gap-2">
                            <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 px-3 py-1">
                              Nécessite fermeture de site
                            </Badge>
                          </div>
                        )}

                        {/* Actions */}
                        {canManage && (
                          <div className="pt-4 border-t border-border/50">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(site)}
                              className="w-full hover:bg-violet-500/10 hover:text-violet-500 font-medium"
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Modifier le site
                            </Button>
                          </div>
                        )}
                      </div>
                    </ModernCard>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Form Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {selectedSite ? 'Modifier le site' : 'Ajouter un site'}
            </DialogTitle>
          </DialogHeader>
          <SiteForm
            site={selectedSite}
            onSuccess={handleFormSuccess}
          />
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation Dialog */}
      <AlertDialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver le site</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir désactiver le site "{siteToToggle?.nom}" ?
              Cette action supprimera tous les plannings associés à ce site.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setSiteToToggle(null);
              setShowDeactivateDialog(false);
            }}>
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (siteToToggle) {
                  await performToggle(siteToToggle);
                  setSiteToToggle(null);
                  setShowDeactivateDialog(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Désactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
