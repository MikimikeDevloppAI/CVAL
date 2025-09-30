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
  created_at?: string;
  updated_at?: string;
}

import { Layout } from '@/components/layout/Layout';

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showClosed, setShowClosed] = useState(false);
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

  const handleToggleStatus = async (siteId: string, currentStatus: boolean, skipConfirmation: boolean = false) => {
    // Si on ferme et qu'on n'a pas skip la confirmation, on ne fait rien ici
    // La confirmation sera gérée par l'AlertDialog
    if (!currentStatus && !skipConfirmation) {
      return;
    }

    try {
      const { error } = await supabase
        .from('sites')
        .update({ fermeture: !currentStatus })
        .eq('id', siteId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: `Site ${!currentStatus ? 'fermé' : 'ouvert'} avec succès`,
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
    
    const matchesStatus = showClosed ? site.fermeture === true : site.fermeture !== true;
    
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
              checked={showClosed}
              onCheckedChange={setShowClosed}
              id="show-closed-sites"
            />
            <label htmlFor="show-closed-sites" className="text-sm font-medium cursor-pointer">
              Montrer sites fermés
            </label>
          </div>
        </div>

        {/* Sites Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSites.map((site) => (
            <ModernCard key={site.id} className={site.fermeture === true ? 'opacity-60' : ''}>
              <ModernCardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ModernCardTitle>
                        {site.nom}
                      </ModernCardTitle>
                      {site.fermeture === true && (
                        <Badge variant="secondary" className="text-xs">
                          Nécessite fermeture de site
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
                    
                    {site.fermeture === true ? (
                      // Switch fermé - réouverture directe
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={false}
                          onCheckedChange={() => handleToggleStatus(site.id, true, true)}
                          className="data-[state=unchecked]:bg-muted"
                        />
                      </div>
                    ) : (
                      // Switch ouvert - avec confirmation pour fermer
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
                            <AlertDialogTitle>Confirmer la fermeture</AlertDialogTitle>
                            <AlertDialogDescription>
                              Êtes-vous sûr de vouloir fermer ce site ?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => handleToggleStatus(site.id, false, true)}
                              className="bg-muted text-muted-foreground hover:bg-muted/90"
                            >
                              Fermer le site
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
                  {/* Statut */}
                  {site.fermeture === true && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Statut
                      </p>
                      <Badge variant="secondary" className="text-xs">
                        Nécessite fermeture de site
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
              {searchTerm ? 'Aucun site trouvé pour cette recherche' : showClosed ? 'Aucun site fermé' : 'Aucun site enregistré'}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}