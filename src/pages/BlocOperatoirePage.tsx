import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Calendar as CalendarIcon, Trash2, Settings, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { BlocOperatoireForm } from '@/components/blocOperatoire/BlocOperatoireForm';
import { DeleteBesoinDialog } from '@/components/blocOperatoire/DeleteBesoinDialog';
import { TypesInterventionManagement } from '@/components/blocOperatoire/TypesInterventionManagement';
import { useToast } from '@/hooks/use-toast';
import { format, startOfWeek, addDays, isSameWeek, parseISO } from 'date-fns';
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

interface Medecin {
  id: string;
  name: string;
  first_name: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
}

const BlocOperatoirePage = () => {
  const [besoins, setBesoins] = useState<BlocOperatoireBesoin[]>([]);
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [selectedBesoin, setSelectedBesoin] = useState<BlocOperatoireBesoin | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [besoinToDelete, setBesoinToDelete] = useState<{ id: string; medecinName: string } | null>(null);
  const [preselectedDate, setPreselectedDate] = useState<Date | null>(null);
  
  // Filtres
  const [selectedMedecin, setSelectedMedecin] = useState<string>('all');
  const [selectedTypeIntervention, setSelectedTypeIntervention] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('');
  
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

  const fetchMedecins = async () => {
    try {
      const { data, error } = await supabase
        .from('medecins')
        .select('id, name, first_name')
        .eq('actif', true)
        .order('first_name');
      
      if (error) throw error;
      setMedecins(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des médecins:', error);
    }
  };

  const fetchTypesIntervention = async () => {
    try {
      const { data, error } = await supabase
        .from('types_intervention')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');
      
      if (error) throw error;
      setTypesIntervention(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des types d\'intervention:', error);
    }
  };

  useEffect(() => {
    fetchBesoins();
    fetchMedecins();
    fetchTypesIntervention();
  }, []);

  const filteredBesoins = besoins.filter(besoin => {
    const besoinDate = new Date(besoin.date);
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    
    // Ne garder que les besoins futurs (>= semaine en cours)
    const isFuture = besoinDate >= currentWeekStart;
    
    // Filtre par médecin
    const matchesMedecin = selectedMedecin === 'all' || besoin.medecin_id === selectedMedecin;
    
    // Filtre par type d'intervention
    const matchesTypeIntervention = selectedTypeIntervention === 'all' || 
      besoin.type_intervention_id === selectedTypeIntervention;
    
    // Filtre par date
    const matchesDate = !selectedDate || besoin.date === selectedDate;
    
    return isFuture && matchesMedecin && matchesTypeIntervention && matchesDate;
  });

  const hasActiveFilters = selectedMedecin !== 'all' || 
    selectedTypeIntervention !== 'all' || 
    selectedDate !== '';

  const clearFilters = () => {
    setSelectedMedecin('all');
    setSelectedTypeIntervention('all');
    setSelectedDate('');
  };

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

  // Grouper par semaine
  const weekGroups: Array<{
    weekStart: Date;
    days: Array<{ date: string; matin: BlocOperatoireBesoin[]; apres_midi: BlocOperatoireBesoin[] }>
  }> = [];

  // Trouver toutes les semaines uniques
  const weeks = new Map<string, Date>();
  filteredBesoins.forEach(besoin => {
    const besoinDate = new Date(besoin.date);
    const weekStart = startOfWeek(besoinDate, { weekStartsOn: 1 });
    const weekKey = format(weekStart, 'yyyy-MM-dd');
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, weekStart);
    }
  });

  // Trier les semaines du plus proche au plus loin
  const sortedWeeks = Array.from(weeks.values()).sort((a, b) => a.getTime() - b.getTime());

  // Pour chaque semaine, créer les jours du lundi au vendredi
  sortedWeeks.forEach(weekStart => {
    const days = [];
    for (let i = 0; i < 5; i++) { // 0 = lundi, 4 = vendredi
      const dayDate = addDays(weekStart, i);
      const dateKey = format(dayDate, 'yyyy-MM-dd');
      
      // Trier les besoins par prénom du médecin
      const matinBesoins = (besoinsByDate[dateKey]?.matin || []).sort((a, b) => 
        (a.medecins?.first_name || '').localeCompare(b.medecins?.first_name || '')
      );
      const apresMidiBesoins = (besoinsByDate[dateKey]?.apres_midi || []).sort((a, b) => 
        (a.medecins?.first_name || '').localeCompare(b.medecins?.first_name || '')
      );
      
      days.push({
        date: dateKey,
        matin: matinBesoins,
        apres_midi: apresMidiBesoins
      });
    }
    weekGroups.push({ weekStart, days });
  });

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

      {/* Filtres */}
          <div className="bg-card border rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Filtres</h3>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="ml-auto h-7 px-2 text-xs"
                >
                  <X className="h-3 w-3 mr-1" />
                  Réinitialiser
                </Button>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Médecin</label>
                <Select value={selectedMedecin} onValueChange={setSelectedMedecin}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les médecins" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les médecins</SelectItem>
                    {medecins.map((medecin) => (
                      <SelectItem key={medecin.id} value={medecin.id}>
                        {medecin.first_name} {medecin.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Type d'intervention</label>
                <Select value={selectedTypeIntervention} onValueChange={setSelectedTypeIntervention}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les types</SelectItem>
                    {typesIntervention.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Date</label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          <div className="space-y-8">
        {weekGroups.map((weekGroup) => (
          <div key={format(weekGroup.weekStart, 'yyyy-MM-dd')} className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground border-b pb-2">
              Semaine du {format(weekGroup.weekStart, 'dd MMMM yyyy', { locale: fr })}
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {weekGroup.days.map((dayGroup) => (
                <div key={dayGroup.date} className="border rounded-lg p-4 bg-card">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold text-foreground">
                        {format(new Date(dayGroup.date), 'EEE dd MMM', { locale: fr })}
                      </h3>
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
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground uppercase">Matin</span>
                      </div>
                      {dayGroup.matin.length > 0 ? (
                        dayGroup.matin.map((besoin) => (
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
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground italic">Aucune opération</p>
                      )}
                    </div>

                    {/* Après-midi */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground uppercase">Après-midi</span>
                      </div>
                      {dayGroup.apres_midi.length > 0 ? (
                        dayGroup.apres_midi.map((besoin) => (
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
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground italic">Aucune opération</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </div>
          ))}
          </div>

          {weekGroups.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {hasActiveFilters ? 'Aucun besoin trouvé avec ces filtres' : 'Aucun besoin enregistré'}
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