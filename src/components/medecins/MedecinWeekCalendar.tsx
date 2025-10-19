import { useState, useEffect } from 'react';
import { format, startOfWeek, addDays, isSameDay, isToday } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, X, Sunrise, Sunset, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { WeekSelector } from '@/components/shared/WeekSelector';
import { AddMultipleCreneauxDialog } from './AddMultipleCreneauxDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

interface MedecinWeekCalendarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  medecinNom: string;
}

interface BesoinEffectif {
  id: string;
  date: string;
  site_id: string;
  demi_journee: 'matin' | 'apres_midi';
  type_intervention_id: string | null;
  sites?: { nom: string; est_bloc_operatoire: boolean };
  types_intervention?: { nom: string };
}

interface Site {
  id: string;
  nom: string;
  est_bloc_operatoire: boolean;
}

interface TypeIntervention {
  id: string;
  nom: string;
}

export function MedecinWeekCalendar({ open, onOpenChange, medecinId, medecinNom }: MedecinWeekCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [besoins, setBesoins] = useState<BesoinEffectif[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [loading, setLoading] = useState(false);

  // Add besoin dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');

  // Delete dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [besoinToDelete, setBesoinToDelete] = useState<string | null>(null);

  // Multiple slots dialog
  const [multipleSlotsOpen, setMultipleSlotsOpen] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSites();
      fetchBesoins();
    }
  }, [open, currentDate, medecinId]);

  const fetchSites = async () => {
    const { data } = await supabase
      .from('sites')
      .select('id, nom, est_bloc_operatoire')
      .eq('actif', true)
      .order('nom');
    if (data) setSites(data);

    const { data: typesData } = await supabase
      .from('types_intervention')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');
    if (typesData) setTypesIntervention(typesData);
  };

  const fetchBesoins = async () => {
    setLoading(true);
    const weekStart = startOfWeek(currentDate, { locale: fr, weekStartsOn: 1 });
    const weekEnd = addDays(weekStart, 6);

    const { data } = await supabase
      .from('besoin_effectif')
      .select(`
        id,
        date,
        site_id,
        demi_journee,
        type_intervention_id,
        sites(nom, est_bloc_operatoire),
        types_intervention(nom)
      `)
      .eq('medecin_id', medecinId)
      .gte('date', format(weekStart, 'yyyy-MM-dd'))
      .lte('date', format(weekEnd, 'yyyy-MM-dd'))
      .order('date')
      .order('demi_journee');

    if (data) setBesoins(data as any);
    setLoading(false);
  };

  const handlePrevWeek = () => {
    setCurrentDate((prev) => addDays(prev, -7));
  };

  const handleNextWeek = () => {
    setCurrentDate((prev) => addDays(prev, 7));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const weekStart = startOfWeek(currentDate, { locale: fr, weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getBesoinsForDate = (date: Date, period: 'matin' | 'apres_midi') => {
    return besoins.filter(
      (b) => isSameDay(new Date(b.date), date) && b.demi_journee === period
    );
  };

  const handleAddClick = (date: Date, period: 'matin' | 'apres_midi') => {
    setSelectedDate(date);
    setSelectedPeriod(period);
    setSelectedSiteId('');
    setSelectedTypeInterventionId('');
    setAddDialogOpen(true);
  };

  const handleAddBesoin = async () => {
    if (!selectedDate || !selectedPeriod || !selectedSiteId) {
      toast.error('Veuillez sélectionner un site');
      return;
    }

    const selectedSite = sites.find((s) => s.id === selectedSiteId);
    if (selectedSite?.est_bloc_operatoire && !selectedTypeInterventionId) {
      toast.error('Veuillez sélectionner un type d\'intervention');
      return;
    }

    setLoading(true);
    const { error } = await supabase.from('besoin_effectif').insert({
      medecin_id: medecinId,
      date: format(selectedDate, 'yyyy-MM-dd'),
      site_id: selectedSiteId,
      demi_journee: selectedPeriod,
      type_intervention_id: selectedSite?.est_bloc_operatoire ? selectedTypeInterventionId : null,
    });

    if (error) {
      toast.error('Erreur lors de l\'ajout');
    } else {
      toast.success('Créneau ajouté');
      fetchBesoins();
      setAddDialogOpen(false);
    }
    setLoading(false);
  };

  const handleDeleteClick = (besoinId: string) => {
    setBesoinToDelete(besoinId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!besoinToDelete) return;

    setLoading(true);
    const { error } = await supabase
      .from('besoin_effectif')
      .delete()
      .eq('id', besoinToDelete);

    if (error) {
      toast.error('Erreur lors de la suppression');
    } else {
      toast.success('Créneau supprimé');
      fetchBesoins();
    }
    setLoading(false);
    setDeleteDialogOpen(false);
    setBesoinToDelete(null);
  };

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-7xl backdrop-blur-xl bg-card/95 border-2 border-cyan-200/50 dark:border-cyan-800/50">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent">
              Calendrier de {medecinNom}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Navigation */}
            <div className="flex items-center justify-between gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevWeek}
                className="backdrop-blur-xl bg-card/95 border-cyan-200/50 dark:border-cyan-800/50 hover:border-cyan-400/70 dark:hover:border-cyan-600/70 hover:shadow-lg hover:shadow-cyan-500/10 transition-all duration-300"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <WeekSelector currentDate={currentDate} onWeekChange={setCurrentDate} />

              <Button
                variant="outline"
                size="icon"
                onClick={handleNextWeek}
                className="backdrop-blur-xl bg-card/95 border-cyan-200/50 dark:border-cyan-800/50 hover:border-cyan-400/70 dark:hover:border-cyan-600/70 hover:shadow-lg hover:shadow-cyan-500/10 transition-all duration-300"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                onClick={handleToday}
                className="backdrop-blur-xl bg-card/95 border-cyan-200/50 dark:border-cyan-800/50 hover:border-cyan-400/70 dark:hover:border-cyan-600/70 hover:shadow-lg hover:shadow-cyan-500/10 transition-all duration-300"
              >
                <CalendarIcon className="h-4 w-4 mr-2" />
                Aujourd'hui
              </Button>

              <Button
                onClick={() => setMultipleSlotsOpen(true)}
                className="backdrop-blur-xl bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-700 hover:to-teal-700 text-white border-0 shadow-lg hover:shadow-xl hover:shadow-cyan-500/20 transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Ajouter plusieurs créneaux
              </Button>
            </div>

            {/* Week Grid */}
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map((day, index) => {
                const dayIsToday = isToday(day);
                const isWeekend = index >= 5;

                return (
                  <div
                    key={day.toISOString()}
                    className={`rounded-xl border-2 backdrop-blur-xl transition-all duration-300 ${
                      dayIsToday
                        ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                        : isWeekend
                        ? 'border-accent/30 bg-accent/5'
                        : 'border-border/50 bg-card/50'
                    }`}
                  >
                    {/* Day Header */}
                    <div className="p-3 border-b border-border/50">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {format(day, 'EEE', { locale: fr })}
                      </div>
                      <div className="text-lg font-bold text-foreground">
                        {format(day, 'd', { locale: fr })}
                      </div>
                      {dayIsToday && (
                        <Badge variant="default" className="mt-1 text-xs bg-primary/20 text-primary border-primary/30">
                          Aujourd'hui
                        </Badge>
                      )}
                    </div>

                    {/* Morning */}
                    <div className="p-2 border-b border-border/30 bg-amber-500/5 min-h-[120px] group">
                      <div className="flex items-center gap-1 mb-2">
                        <Sunrise className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Matin</span>
                      </div>
                      <div className="space-y-1">
                        {getBesoinsForDate(day, 'matin').map((besoin) => (
                          <div
                            key={besoin.id}
                            className="relative group/item p-2 rounded-lg bg-teal-500/10 border border-teal-200/50 dark:border-teal-800/50 hover:bg-teal-500/20 hover:shadow-md transition-all duration-200"
                          >
                            <div className="text-xs font-medium text-teal-700 dark:text-teal-300">
                              🏥 {besoin.sites?.nom}
                            </div>
                            {besoin.types_intervention && (
                              <div className="text-xs text-muted-foreground mt-1">
                                📋 {besoin.types_intervention.nom}
                              </div>
                            )}
                            <button
                              onClick={() => handleDeleteClick(besoin.id)}
                              className="absolute -top-1 -right-1 opacity-0 group-hover/item:opacity-100 transition-opacity bg-destructive text-destructive-foreground rounded-full p-1 hover:scale-110 shadow-lg"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => handleAddClick(day, 'matin')}
                        className="w-full mt-2 p-2 rounded-lg border-2 border-dashed border-teal-300/50 dark:border-teal-700/50 opacity-0 group-hover:opacity-100 hover:border-teal-400 hover:bg-teal-500/10 transition-all duration-200 flex items-center justify-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-400"
                      >
                        <Plus className="h-3 w-3" />
                        Ajouter
                      </button>
                    </div>

                    {/* Afternoon */}
                    <div className="p-2 bg-blue-500/5 min-h-[120px] group">
                      <div className="flex items-center gap-1 mb-2">
                        <Sunset className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                        <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Après-midi</span>
                      </div>
                      <div className="space-y-1">
                        {getBesoinsForDate(day, 'apres_midi').map((besoin) => (
                          <div
                            key={besoin.id}
                            className="relative group/item p-2 rounded-lg bg-cyan-500/10 border border-cyan-200/50 dark:border-cyan-800/50 hover:bg-cyan-500/20 hover:shadow-md transition-all duration-200"
                          >
                            <div className="text-xs font-medium text-cyan-700 dark:text-cyan-300">
                              🏥 {besoin.sites?.nom}
                            </div>
                            {besoin.types_intervention && (
                              <div className="text-xs text-muted-foreground mt-1">
                                📋 {besoin.types_intervention.nom}
                              </div>
                            )}
                            <button
                              onClick={() => handleDeleteClick(besoin.id)}
                              className="absolute -top-1 -right-1 opacity-0 group-hover/item:opacity-100 transition-opacity bg-destructive text-destructive-foreground rounded-full p-1 hover:scale-110 shadow-lg"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => handleAddClick(day, 'apres_midi')}
                        className="w-full mt-2 p-2 rounded-lg border-2 border-dashed border-cyan-300/50 dark:border-cyan-700/50 opacity-0 group-hover:opacity-100 hover:border-cyan-400 hover:bg-cyan-500/10 transition-all duration-200 flex items-center justify-center gap-1 text-xs font-medium text-cyan-600 dark:text-cyan-400"
                      >
                        <Plus className="h-3 w-3" />
                        Ajouter
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Besoin Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="backdrop-blur-xl bg-card/95 border-2 border-cyan-200/50 dark:border-cyan-800/50">
          <DialogHeader>
            <DialogTitle>Ajouter un créneau</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Site</label>
              <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedSite?.est_bloc_operatoire && (
              <div>
                <label className="text-sm font-medium">Type d'intervention</label>
                <Select value={selectedTypeInterventionId} onValueChange={setSelectedTypeInterventionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un type" />
                  </SelectTrigger>
                  <SelectContent>
                    {typesIntervention.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleAddBesoin}
                disabled={loading}
                className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-700 hover:to-teal-700"
              >
                Ajouter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer ce créneau ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Multiple Slots Dialog */}
      <AddMultipleCreneauxDialog
        open={multipleSlotsOpen}
        onOpenChange={setMultipleSlotsOpen}
        medecinId={medecinId}
        onSuccess={fetchBesoins}
      />
    </>
  );
}
