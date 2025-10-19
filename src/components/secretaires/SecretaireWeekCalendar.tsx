import { useState, useEffect } from 'react';
import { format, startOfWeek, addDays, isSameDay, isToday } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, X, Sunrise, Sunset, Calendar as CalendarIcon, MapPin } from 'lucide-react';
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

interface SecretaireWeekCalendarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaireId: string;
  secretaireNom: string;
}

interface CapaciteEffective {
  id: string;
  date: string;
  site_id: string;
  demi_journee: 'matin' | 'apres_midi';
  sites?: { nom: string; couleur?: string };
}

interface Site {
  id: string;
  nom: string;
  couleur?: string;
}

const SITE_COLORS = [
  'bg-rose-500/20 border-rose-300/50 text-rose-700 dark:border-rose-800/50 dark:text-rose-300',
  'bg-violet-500/20 border-violet-300/50 text-violet-700 dark:border-violet-800/50 dark:text-violet-300',
  'bg-blue-500/20 border-blue-300/50 text-blue-700 dark:border-blue-800/50 dark:text-blue-300',
  'bg-emerald-500/20 border-emerald-300/50 text-emerald-700 dark:border-emerald-800/50 dark:text-emerald-300',
  'bg-amber-500/20 border-amber-300/50 text-amber-700 dark:border-amber-800/50 dark:text-amber-300',
  'bg-pink-500/20 border-pink-300/50 text-pink-700 dark:border-pink-800/50 dark:text-pink-300',
];

export function SecretaireWeekCalendar({ open, onOpenChange, secretaireId, secretaireNom }: SecretaireWeekCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [capacites, setCapacites] = useState<CapaciteEffective[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteColorMap, setSiteColorMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  // Add capacite dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');

  // Delete dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [capaciteToDelete, setCapaciteToDelete] = useState<string | null>(null);

  // Multiple slots dialog
  const [multipleSlotsOpen, setMultipleSlotsOpen] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSites();
      fetchCapacites();
    }
  }, [open, currentDate, secretaireId]);

  useEffect(() => {
    // Assign colors to sites
    const colorMap = new Map<string, string>();
    sites.forEach((site, index) => {
      colorMap.set(site.id, SITE_COLORS[index % SITE_COLORS.length]);
    });
    setSiteColorMap(colorMap);
  }, [sites]);

  const fetchSites = async () => {
    const { data } = await supabase
      .from('sites')
      .select('id, nom, couleur')
      .eq('actif', true)
      .order('nom');
    if (data) setSites(data);
  };

  const fetchCapacites = async () => {
    setLoading(true);
    const weekStart = startOfWeek(currentDate, { locale: fr, weekStartsOn: 1 });
    const weekEnd = addDays(weekStart, 6);

    const { data } = await supabase
      .from('capacite_effective')
      .select(`
        id,
        date,
        site_id,
        demi_journee,
        sites(nom, couleur)
      `)
      .eq('secretaire_id', secretaireId)
      .gte('date', format(weekStart, 'yyyy-MM-dd'))
      .lte('date', format(weekEnd, 'yyyy-MM-dd'))
      .order('date')
      .order('demi_journee');

    if (data) setCapacites(data as any);
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

  const getCapacitesForDate = (date: Date, period: 'matin' | 'apres_midi') => {
    return capacites.filter(
      (c) => isSameDay(new Date(c.date), date) && c.demi_journee === period
    );
  };

  const handleAddClick = (date: Date, period: 'matin' | 'apres_midi') => {
    setSelectedDate(date);
    setSelectedPeriod(period);
    setSelectedSiteId('');
    setAddDialogOpen(true);
  };

  const handleAddCapacite = async () => {
    if (!selectedDate || !selectedPeriod || !selectedSiteId) {
      toast.error('Veuillez sélectionner un site');
      return;
    }

    setLoading(true);
    const { error } = await supabase.from('capacite_effective').insert({
      secretaire_id: secretaireId,
      date: format(selectedDate, 'yyyy-MM-dd'),
      site_id: selectedSiteId,
      demi_journee: selectedPeriod,
    });

    if (error) {
      toast.error('Erreur lors de l\'ajout');
    } else {
      toast.success('Créneau ajouté');
      fetchCapacites();
      setAddDialogOpen(false);
    }
    setLoading(false);
  };

  const handleDeleteClick = (capaciteId: string) => {
    setCapaciteToDelete(capaciteId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!capaciteToDelete) return;

    setLoading(true);
    const { error } = await supabase
      .from('capacite_effective')
      .delete()
      .eq('id', capaciteToDelete);

    if (error) {
      toast.error('Erreur lors de la suppression');
    } else {
      toast.success('Créneau supprimé');
      fetchCapacites();
    }
    setLoading(false);
    setDeleteDialogOpen(false);
    setCapaciteToDelete(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-7xl backdrop-blur-xl bg-card/95 border-2 border-teal-200/50 dark:border-teal-800/50">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
              Calendrier de {secretaireNom}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Navigation */}
            <div className="flex items-center justify-between gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevWeek}
                className="backdrop-blur-xl bg-card/95 border-teal-200/50 dark:border-teal-800/50 hover:border-teal-400/70 dark:hover:border-teal-600/70 hover:shadow-lg hover:shadow-teal-500/10 transition-all duration-300"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <WeekSelector currentDate={currentDate} onWeekChange={setCurrentDate} />

              <Button
                variant="outline"
                size="icon"
                onClick={handleNextWeek}
                className="backdrop-blur-xl bg-card/95 border-teal-200/50 dark:border-teal-800/50 hover:border-teal-400/70 dark:hover:border-teal-600/70 hover:shadow-lg hover:shadow-teal-500/10 transition-all duration-300"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                onClick={handleToday}
                className="backdrop-blur-xl bg-card/95 border-teal-200/50 dark:border-teal-800/50 hover:border-teal-400/70 dark:hover:border-teal-600/70 hover:shadow-lg hover:shadow-teal-500/10 transition-all duration-300"
              >
                <CalendarIcon className="h-4 w-4 mr-2" />
                Aujourd'hui
              </Button>

              <Button
                onClick={() => setMultipleSlotsOpen(true)}
                className="backdrop-blur-xl bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white border-0 shadow-lg hover:shadow-xl hover:shadow-teal-500/20 transition-all duration-300"
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
                        {getCapacitesForDate(day, 'matin').map((capacite) => {
                          const colorClass = siteColorMap.get(capacite.site_id) || SITE_COLORS[0];
                          return (
                            <div
                              key={capacite.id}
                              className={`relative group/item p-2 rounded-lg border hover:shadow-md transition-all duration-200 ${colorClass}`}
                            >
                              <div className="flex items-center gap-1 text-xs font-medium">
                                <MapPin className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{capacite.sites?.nom}</span>
                              </div>
                              <button
                                onClick={() => handleDeleteClick(capacite.id)}
                                className="absolute -top-1 -right-1 opacity-0 group-hover/item:opacity-100 transition-opacity bg-destructive text-destructive-foreground rounded-full p-1 hover:scale-110 shadow-lg"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
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
                        {getCapacitesForDate(day, 'apres_midi').map((capacite) => {
                          const colorClass = siteColorMap.get(capacite.site_id) || SITE_COLORS[0];
                          return (
                            <div
                              key={capacite.id}
                              className={`relative group/item p-2 rounded-lg border hover:shadow-md transition-all duration-200 ${colorClass}`}
                            >
                              <div className="flex items-center gap-1 text-xs font-medium">
                                <MapPin className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{capacite.sites?.nom}</span>
                              </div>
                              <button
                                onClick={() => handleDeleteClick(capacite.id)}
                                className="absolute -top-1 -right-1 opacity-0 group-hover/item:opacity-100 transition-opacity bg-destructive text-destructive-foreground rounded-full p-1 hover:scale-110 shadow-lg"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => handleAddClick(day, 'apres_midi')}
                        className="w-full mt-2 p-2 rounded-lg border-2 border-dashed border-teal-300/50 dark:border-teal-700/50 opacity-0 group-hover:opacity-100 hover:border-teal-400 hover:bg-teal-500/10 transition-all duration-200 flex items-center justify-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-400"
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

      {/* Add Capacite Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="backdrop-blur-xl bg-card/95 border-2 border-teal-200/50 dark:border-teal-800/50">
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
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3 w-3" />
                        {site.nom}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleAddCapacite}
                disabled={loading}
                className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700"
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
        secretaireId={secretaireId}
        onSuccess={fetchCapacites}
      />
    </>
  );
}
