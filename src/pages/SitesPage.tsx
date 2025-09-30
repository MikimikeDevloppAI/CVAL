import { useState, useEffect } from 'react';
import { Plus, Edit, Search, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle, ContactInfo } from '@/components/ui/modern-card';
import { SiteForm } from '@/components/sites/SiteForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Site {
  id: string;
  nom: string;
  adresse: string;
  fermeture?: boolean;
  actif?: boolean;
  created_at?: string;
  updated_at?: string;
}

import { Layout } from '@/components/layout/Layout';

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchSites = async () => {
    try {
      const { data: sitesData, error: sitesError } = await supabase
        .from('sites')
        .select(`
          id,
          nom,
          adresse,
          fermeture,
          actif,
          created_at,
          updated_at
        `)
        .order('nom');

      if (sitesError) throw sitesError;
      setSites(sitesData || []);
    } catch (error) {
      console.error('Erreur lors du chargement des sites:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les sites",
        variant: "destructive",
      });
      setSites([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, []);

  const handleToggleActif = async (siteId: string, currentActif: boolean, skipConfirmation: boolean = false) => {
    // Si on désactive et qu'on n'a pas skip la confirmation, on ne fait rien ici
    // La confirmation sera gérée par l'AlertDialog
    if (currentActif && !skipConfirmation) {
      return;
    }

    try {
      const { error } = await supabase
        .from('sites')
        .update({ actif: !currentActif })
        .eq('id', siteId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: `Site ${!currentActif ? 'activé' : 'désactivé'} avec succès`,
      });
      
      fetchSites();
    } catch (error) {
      console.error('Erreur lors de la modification du statut:', error);
      toast({
        title: "Erreur",
        description: "Impossible de modifier le statut du site",
        variant: "destructive",
      });
    }
  };

  const filteredSites = sites.filter(site => {
    const matchesSearch = site.nom?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           site.adresse?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           site.id.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = showInactive ? site.actif === false : site.actif !== false;
    
    return matchesSearch && matchesStatus;
  });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedSite(null);
    fetchSites();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Gestion des Sites</h1>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => setSelectedSite(null)}>
                <Plus className="h-4 w-4" />
                Ajouter un site
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
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
        </div>

        {/* Search and Filter */}
        <div className="flex items-center space-x-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un site..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              id="show-inactive-sites"
            />
            <label htmlFor="show-inactive-sites" className="text-sm font-medium cursor-pointer">
              Montrer sites inactifs
            </label>
          </div>
        </div>

        {/* Sites Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSites.map((site) => (
            <ModernCard key={site.id} className={site.actif === false ? 'opacity-60' : ''}>
              <ModernCardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ModernCardTitle>
                        {site.nom}
                      </ModernCardTitle>
                      {site.actif === false && (
                        <Badge variant="secondary" className="text-xs">
                          Inactif
                        </Badge>
                      )}
                    </div>
                    
                    <div className="space-y-3 mt-4">
                      {site.adresse && (
                        <ContactInfo 
                          icon={<MapPin />} 
                          text={site.adresse} 
                        />
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3 ml-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedSite(site);
                        setIsDialogOpen(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    
                    {site.actif === false ? (
                      // Switch inactif - activation directe
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={false}
                          onCheckedChange={() => handleToggleActif(site.id, false, true)}
                          className="data-[state=unchecked]:bg-muted"
                        />
                      </div>
                    ) : (
                      // Switch actif - avec confirmation pour désactiver
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={true}
                              className="data-[state=checked]:bg-primary"
                            />
                          </div>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
                            <AlertDialogDescription>
                              Êtes-vous sûr de vouloir désactiver ce site ?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => handleToggleActif(site.id, true, true)}
                              className="bg-muted text-muted-foreground hover:bg-muted/90"
                            >
                              Désactiver le site
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </ModernCardHeader>
              
              <ModernCardContent>
                <div className="space-y-4">
                  {site.fermeture === true && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Nécessite fermeture de site
                      </p>
                      <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700">
                        Oui
                      </Badge>
                    </div>
                  )}
                </div>
              </ModernCardContent>
            </ModernCard>
          ))}
        </div>

        {filteredSites.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm ? 'Aucun site trouvé pour cette recherche' : showInactive ? 'Aucun site inactif' : 'Aucun site enregistré'}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}