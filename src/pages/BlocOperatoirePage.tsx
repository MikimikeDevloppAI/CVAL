import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle } from '@/components/ui/modern-card';
import { supabase } from '@/integrations/supabase/client';
import { BlocOperatoireForm } from '@/components/blocOperatoire/BlocOperatoireForm';
import { useToast } from '@/hooks/use-toast';
import { format, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface BlocOperatoireBesoin {
  id: string;
  date: string;
  medecin_id: string;
  type_intervention_id: string;
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  actif: boolean;
  medecins: {
    name: string;
    first_name: string;
  };
  types_intervention?: {
    nom: string;
  };
}

const BlocOperatoirePage = () => {
  const [besoins, setBesoins] = useState<BlocOperatoireBesoin[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBesoin, setSelectedBesoin] = useState<BlocOperatoireBesoin | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const fetchBesoins = async () => {
    try {
      // Fetch bloc site ID
      const { data: siteData } = await supabase
        .from('sites')
        .select('id')
        .ilike('nom', '%bloc%')
        .limit(1)
        .single();

      const blocSiteId = siteData?.id;
      if (!blocSiteId) {
        setBesoins([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('besoin_effectif')
        .select(`
          *,
          medecins (
            name,
            first_name
          ),
          types_intervention (
            nom
          )
        `)
        .eq('type', 'medecin')
        .eq('site_id', blocSiteId)
        .order('date', { ascending: false });

      if (error) throw error;
      setBesoins(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des besoins:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors du chargement des besoins",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBesoins();
  }, []);

  const filteredBesoins = besoins.filter(besoin => {
    const besoinDate = new Date(besoin.date);
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // 1 = Lundi
    
    // Ne garder que les besoins futurs (>= semaine en cours)
    const isFuture = besoinDate >= currentWeekStart;
    
    const medecinName = `${besoin.medecins?.first_name || ''} ${besoin.medecins?.name || ''}`.toLowerCase();
    const matchesSearch = medecinName.includes(searchTerm.toLowerCase()) ||
           format(besoinDate, 'dd/MM/yyyy', { locale: fr }).includes(searchTerm);
    
    return isFuture && matchesSearch;
  });

  // Grouper les besoins par date pour affichage par jour
  const besoinsByDate = filteredBesoins.reduce((acc, besoin) => {
    const dateKey = besoin.date;
    if (!acc[dateKey]) {
      acc[dateKey] = {
        date: besoin.date,
        matin: [],
        apres_midi: []
      };
    }
    if (besoin.demi_journee === 'matin') {
      acc[dateKey].matin.push(besoin);
    } else if (besoin.demi_journee === 'apres_midi') {
      acc[dateKey].apres_midi.push(besoin);
    }
    return acc;
  }, {} as Record<string, { date: string; matin: BlocOperatoireBesoin[]; apres_midi: BlocOperatoireBesoin[] }>);

  // Convertir en tableau et trier du plus récent au plus ancien
  const groupedBesoins = Object.values(besoinsByDate).sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedBesoin(null);
    fetchBesoins();
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: "Succès",
        description: "Besoin supprimé avec succès",
      });
      
      fetchBesoins();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors de la suppression",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Bloc Opératoire</h1>
        
        {canManage && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => setSelectedBesoin(null)}>
                <Plus className="h-4 w-4" />
                Ajouter un besoin
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedBesoin ? 'Modifier le besoin' : 'Ajouter un besoin'}
              </DialogTitle>
            </DialogHeader>
            <BlocOperatoireForm 
              besoin={selectedBesoin} 
              onSubmit={handleFormSuccess}
              onCancel={() => setIsDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* Search */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
        <div className="relative flex-1 max-w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher par médecin ou date..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="space-y-6">
        {groupedBesoins.map((dayGroup) => (
          <div key={dayGroup.date} className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2">
              <CalendarIcon className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">
                {format(new Date(dayGroup.date), 'EEEE dd MMMM yyyy', { locale: fr })}
              </h2>
            </div>

            {/* Matin */}
            {dayGroup.matin.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  🌅 Matin
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {dayGroup.matin.map((besoin) => (
                    <ModernCard key={besoin.id}>
                      <ModernCardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 space-y-2">
                            <Badge variant="secondary">
                              {besoin.medecins?.first_name} {besoin.medecins?.name}
                            </Badge>
                            {besoin.types_intervention && (
                              <Badge variant="outline" className="text-xs">
                                {besoin.types_intervention.nom}
                              </Badge>
                            )}
                          </div>
                          
                          {canManage && (
                            <div className="flex items-center space-x-2 ml-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedBesoin(besoin);
                                  setIsDialogOpen(true);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(besoin.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </ModernCardHeader>
                    </ModernCard>
                  ))}
                </div>
              </div>
            )}

            {/* Après-midi */}
            {dayGroup.apres_midi.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  ☀️ Après-midi
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {dayGroup.apres_midi.map((besoin) => (
                    <ModernCard key={besoin.id}>
                      <ModernCardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 space-y-2">
                            <Badge variant="secondary">
                              {besoin.medecins?.first_name} {besoin.medecins?.name}
                            </Badge>
                            {besoin.types_intervention && (
                              <Badge variant="outline" className="text-xs">
                                {besoin.types_intervention.nom}
                              </Badge>
                            )}
                          </div>
                          
                          {canManage && (
                            <div className="flex items-center space-x-2 ml-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedBesoin(besoin);
                                  setIsDialogOpen(true);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(besoin.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </ModernCardHeader>
                    </ModernCard>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {groupedBesoins.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchTerm ? 'Aucun besoin trouvé pour cette recherche' : 'Aucun besoin enregistré'}
          </p>
        </div>
      )}
    </div>
  );
};

export default BlocOperatoirePage;