import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Calendar as CalendarIcon, Trash2, Sunrise, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { BlocOperatoireForm } from '@/components/blocOperatoire/BlocOperatoireForm';
import { DeleteBesoinDialog } from '@/components/blocOperatoire/DeleteBesoinDialog';
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [besoinToDelete, setBesoinToDelete] = useState<{ id: string; medecinName: string } | null>(null);
  const [preselectedDate, setPreselectedDate] = useState<Date | null>(null);
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

  // Convertir en tableau et trier du plus proche au plus loin
  const groupedBesoins = Object.values(besoinsByDate).sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedBesoin(null);
    fetchBesoins();
  };

  const handleDeleteClick = (besoin: BlocOperatoireBesoin) => {
    setBesoinToDelete({
      id: besoin.id,
      medecinName: `${besoin.medecins?.first_name} ${besoin.medecins?.name}`,
    });
    setDeleteDialogOpen(true);
  };

  const handleAddForDate = (dateString: string) => {
    setPreselectedDate(new Date(dateString));
    setSelectedBesoin(null);
    setIsDialogOpen(true);
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setSelectedBesoin(null);
    setPreselectedDate(null);
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
          <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => {
                setSelectedBesoin(null);
                setPreselectedDate(null);
              }}>
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
              preselectedDate={preselectedDate}
              onSubmit={() => {
                handleDialogClose();
                fetchBesoins();
              }}
              onCancel={handleDialogClose}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {groupedBesoins.map((dayGroup) => (
          <div key={dayGroup.date} className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3 pb-2 border-b">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">
                  {format(new Date(dayGroup.date), 'EEE dd MMM', { locale: fr })}
                </h2>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleAddForDate(dayGroup.date)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {/* Matin */}
              {dayGroup.matin.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Sunrise className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase">Matin</span>
                  </div>
                  {dayGroup.matin.map((besoin) => (
                    <div 
                      key={besoin.id} 
                      className="group relative p-2 rounded border bg-background hover:bg-accent/50 transition-colors"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {besoin.medecins?.first_name} {besoin.medecins?.name}
                        </p>
                        {besoin.types_intervention && (
                          <p className="text-xs text-muted-foreground">
                            {besoin.types_intervention.nom}
                          </p>
                        )}
                      </div>
                      
                      {canManage && (
                        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setSelectedBesoin(besoin);
                              setIsDialogOpen(true);
                            }}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteClick(besoin)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Après-midi */}
              {dayGroup.apres_midi.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Sun className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase">Après-midi</span>
                  </div>
                  {dayGroup.apres_midi.map((besoin) => (
                    <div 
                      key={besoin.id} 
                      className="group relative p-2 rounded border bg-background hover:bg-accent/50 transition-colors"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {besoin.medecins?.first_name} {besoin.medecins?.name}
                        </p>
                        {besoin.types_intervention && (
                          <p className="text-xs text-muted-foreground">
                            {besoin.types_intervention.nom}
                          </p>
                        )}
                      </div>
                      
                      {canManage && (
                        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setSelectedBesoin(besoin);
                              setIsDialogOpen(true);
                            }}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteClick(besoin)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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

      {besoinToDelete && (
        <DeleteBesoinDialog
          besoinId={besoinToDelete.id}
          medecinName={besoinToDelete.medecinName}
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onSuccess={fetchBesoins}
        />
      )}
    </div>
  );
};

export default BlocOperatoirePage;