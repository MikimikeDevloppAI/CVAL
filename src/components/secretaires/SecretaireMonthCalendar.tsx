import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, startOfWeek, endOfWeek, addMonths, subMonths, getDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, X, Calendar as CalendarIcon, UserCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { checkSecretaireOverlap, getOverlapErrorMessage } from '@/lib/overlapValidation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
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
import { cn } from '@/lib/utils';

interface SecretaireMonthCalendarProps {
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
  sites?: { nom: string };
}

interface Site {
  id: string;
  nom: string;
}

interface DaySlot {
  site: string;
  siteId: string;
  periodes: ('matin' | 'apres_midi')[];
  ids: string[];
  color: string;
}

export function SecretaireMonthCalendar({ open, onOpenChange, secretaireId, secretaireNom }: SecretaireMonthCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [capacites, setCapacites] = useState<CapaciteEffective[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);

  // Add dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');

  // Edit dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<DaySlot | null>(null);
  const [selectedPeriode, setSelectedPeriode] = useState<'toute_journee' | 'matin' | 'apres_midi' | null>(null);

  // Delete dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [capaciteToDelete, setCapaciteToDelete] = useState<string | null>(null);

  // Multiple slots dialog
  const [multipleSlotsOpen, setMultipleSlotsOpen] = useState(false);

  const SITE_COLORS = [
    'hsl(var(--primary))',
    'hsl(var(--secondary))',
    'hsl(var(--planning-event-teal))',
    'hsl(var(--planning-event-purple))',
    'hsl(var(--planning-event-orange))',
  ];

  useEffect(() => {
    if (open) {
      fetchSites();
      fetchCapacites();
    }
  }, [open, currentDate, secretaireId]);

  const fetchSites = async () => {
    const { data } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');
    if (data) setSites(data);
  };

  const fetchCapacites = async () => {
    setLoading(true);
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);

    const { data } = await supabase
      .from('capacite_effective')
      .select(`
        id,
        date,
        site_id,
        demi_journee,
        sites(nom)
      `)
      .eq('secretaire_id', secretaireId)
      .gte('date', format(monthStart, 'yyyy-MM-dd'))
      .lte('date', format(monthEnd, 'yyyy-MM-dd'))
      .order('date')
      .order('demi_journee');

    if (data) setCapacites(data as any);
    setLoading(false);
  };

  const handlePrevMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const getSiteColor = (siteId: string) => {
    const index = sites.findIndex((s) => s.id === siteId);
    return SITE_COLORS[index % SITE_COLORS.length];
  };

  const getDaySlots = (date: Date): DaySlot[] => {
    const matin = capacites.filter(
      (c) => isSameDay(new Date(c.date), date) && c.demi_journee === 'matin'
    );
    const apresmidi = capacites.filter(
      (c) => isSameDay(new Date(c.date), date) && c.demi_journee === 'apres_midi'
    );

    const slots: DaySlot[] = [];

    // Grouper par site pour unifier les slots
    const siteIds = new Set([...matin.map((m) => m.site_id), ...apresmidi.map((a) => a.site_id)]);

    siteIds.forEach((siteId) => {
      const matinForSite = matin.find((m) => m.site_id === siteId);
      const apresmidiForSite = apresmidi.find((a) => a.site_id === siteId);

      if (matinForSite && apresmidiForSite) {
        // Même site matin + après-midi → 1 ligne
        slots.push({
          site: matinForSite.sites?.nom || 'Site',
          siteId,
          periodes: ['matin', 'apres_midi'],
          ids: [matinForSite.id, apresmidiForSite.id],
          color: getSiteColor(siteId),
        });
      } else if (matinForSite) {
        // Matin uniquement
        slots.push({
          site: matinForSite.sites?.nom || 'Site',
          siteId,
          periodes: ['matin'],
          ids: [matinForSite.id],
          color: getSiteColor(siteId),
        });
      } else if (apresmidiForSite) {
        // Après-midi uniquement
        slots.push({
          site: apresmidiForSite.sites?.nom || 'Site',
          siteId,
          periodes: ['apres_midi'],
          ids: [apresmidiForSite.id],
          color: getSiteColor(siteId),
        });
      }
    });

    return slots;
  };

  const handleAddClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedSiteId('');
    setSelectedPeriode(null);
    setAddDialogOpen(true);
  };

  const handleAddCapacite = async () => {
    if (!selectedDate || !selectedSiteId || !selectedPeriode) {
      toast.error('Veuillez sélectionner un site et une période');
      return;
    }

    setLoading(true);

    try {
      // Check for overlaps before adding
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const periodesToCheck: ('matin' | 'apres_midi')[] = 
        selectedPeriode === 'toute_journee' ? ['matin', 'apres_midi'] : [selectedPeriode];

      const overlapResult = await checkSecretaireOverlap(secretaireId, dateStr, periodesToCheck);
      if (overlapResult.hasOverlap) {
        toast.error(getOverlapErrorMessage(overlapResult, 'secretaire'));
        setLoading(false);
        return;
      }

      // If "toute_journee" is selected, insert both morning and afternoon
      if (selectedPeriode === 'toute_journee') {
        const capacites = [
          {
            secretaire_id: secretaireId,
            date: dateStr,
            site_id: selectedSiteId,
            demi_journee: 'matin' as const,
          },
          {
            secretaire_id: secretaireId,
            date: dateStr,
            site_id: selectedSiteId,
            demi_journee: 'apres_midi' as const,
          }
        ];
        const { error } = await supabase.from('capacite_effective').insert(capacites);
        if (error) throw error;
        toast.success('Créneaux matin et après-midi ajoutés');
      } else {
        const { error } = await supabase.from('capacite_effective').insert({
          secretaire_id: secretaireId,
          date: dateStr,
          site_id: selectedSiteId,
          demi_journee: selectedPeriode,
        });
        if (error) throw error;
        toast.success('Créneau ajouté');
      }

      fetchCapacites();
      setAddDialogOpen(false);
    } catch (error) {
      console.error('Error adding capacite:', error);
      toast.error("Erreur lors de l'ajout");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (capaciteIds: string[]) => {
    setCapaciteToDelete(capaciteIds.join(','));
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!capaciteToDelete) return;

    setLoading(true);
    const ids = capaciteToDelete.split(',');

    for (const id of ids) {
      await supabase.from('capacite_effective').delete().eq('id', id);
    }

    toast.success('Créneau supprimé');
    fetchCapacites();
    setLoading(false);
    setDeleteDialogOpen(false);
    setCapaciteToDelete(null);
  };

  const handleEditClick = (slot: DaySlot) => {
    setEditingSlot(slot);
    setSelectedSiteId(slot.siteId);
    
    // Détecter la période initiale: si les deux périodes sont présentes, afficher "toute_journee"
    if (slot.periodes.length === 2) {
      setSelectedPeriode('toute_journee');
    } else if (slot.periodes.includes('matin')) {
      setSelectedPeriode('matin');
    } else {
      setSelectedPeriode('apres_midi');
    }
    
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editingSlot || !selectedSiteId) {
      toast.error('Veuillez sélectionner un site');
      return;
    }

    const dateStr = editingSlot.ids.length > 0 
      ? capacites.find(c => c.id === editingSlot.ids[0])?.date 
      : null;

    if (!dateStr) {
      toast.error('Date non trouvée');
      return;
    }

    setLoading(true);

    try {
      // Déterminer quels capacites existantes on doit garder/modifier/supprimer
      const matinCapacite = capacites.find(c => editingSlot.ids.includes(c.id) && c.demi_journee === 'matin');
      const apresmidiCapacite = capacites.find(c => editingSlot.ids.includes(c.id) && c.demi_journee === 'apres_midi');

      if (selectedPeriode === 'toute_journee') {
        // Modifier journée complète : assurer que matin ET après-midi existent
        if (matinCapacite) {
          await supabase
            .from('capacite_effective')
            .update({
              site_id: selectedSiteId,
            })
            .eq('id', matinCapacite.id);
        } else {
          // Créer le matin s'il n'existe pas
          await supabase.from('capacite_effective').insert({
            secretaire_id: secretaireId,
            date: dateStr,
            site_id: selectedSiteId,
            demi_journee: 'matin',
          });
        }

        if (apresmidiCapacite) {
          await supabase
            .from('capacite_effective')
            .update({
              site_id: selectedSiteId,
            })
            .eq('id', apresmidiCapacite.id);
        } else {
          // Créer l'après-midi s'il n'existe pas
          await supabase.from('capacite_effective').insert({
            secretaire_id: secretaireId,
            date: dateStr,
            site_id: selectedSiteId,
            demi_journee: 'apres_midi',
          });
        }
      } else if (selectedPeriode === 'matin') {
        // Modifier uniquement le matin, supprimer l'après-midi si existe
        if (matinCapacite) {
          await supabase
            .from('capacite_effective')
            .update({
              site_id: selectedSiteId,
            })
            .eq('id', matinCapacite.id);
        } else {
          // Créer le matin s'il n'existe pas
          await supabase.from('capacite_effective').insert({
            secretaire_id: secretaireId,
            date: dateStr,
            site_id: selectedSiteId,
            demi_journee: 'matin',
          });
        }

        // Supprimer l'après-midi si existe
        if (apresmidiCapacite) {
          await supabase.from('capacite_effective').delete().eq('id', apresmidiCapacite.id);
        }
      } else {
        // selectedPeriode === 'apres_midi'
        // Modifier uniquement l'après-midi, supprimer le matin si existe
        if (apresmidiCapacite) {
          await supabase
            .from('capacite_effective')
            .update({
              site_id: selectedSiteId,
            })
            .eq('id', apresmidiCapacite.id);
        } else {
          // Créer l'après-midi s'il n'existe pas
          await supabase.from('capacite_effective').insert({
            secretaire_id: secretaireId,
            date: dateStr,
            site_id: selectedSiteId,
            demi_journee: 'apres_midi',
          });
        }

        // Supprimer le matin si existe
        if (matinCapacite) {
          await supabase.from('capacite_effective').delete().eq('id', matinCapacite.id);
        }
      }

      toast.success('Créneau modifié');
      fetchCapacites();
      setEditDialogOpen(false);
      setEditingSlot(null);
    } catch (error) {
      toast.error('Erreur lors de la modification');
    } finally {
      setLoading(false);
    }
  };

  // Générer les jours du mois avec padding
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { locale: fr, weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { locale: fr, weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Filter out Sundays (getDay() === 0)
  const calendarDaysWithoutSunday = calendarDays.filter(day => getDay(day) !== 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto backdrop-blur-xl bg-card/95 border border-border/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center">
                <UserCircle className="h-5 w-5 text-sky-500" />
              </div>
              <span className="text-xl font-bold text-foreground">Calendrier de {secretaireNom}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Calendrier mensuel de la secrétaire {secretaireNom}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Navigation */}
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevMonth}
                className="h-8 w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="text-base font-semibold text-foreground capitalize">
                {format(currentDate, 'MMMM yyyy', { locale: fr })}
              </div>

              <Button
                variant="outline"
                size="icon"
                onClick={handleNextMonth}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                onClick={handleToday}
                className="h-8 text-xs"
              >
                <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                Aujourd'hui
              </Button>

              <Button
                onClick={() => setMultipleSlotsOpen(true)}
                className="h-8 text-xs bg-primary hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Ajouter plusieurs
              </Button>
            </div>

            {/* Week days header - 6 columns (no Sunday) */}
            <div className="grid grid-cols-6 gap-1.5">
              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map((day, idx) => (
                <div
                  key={day}
                  className={cn(
                    'text-center text-[10px] font-semibold uppercase tracking-wider py-1.5 rounded-lg',
                    idx === 5 ? 'text-muted-foreground bg-accent/30' : 'text-foreground bg-muted/50'
                  )}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid - 6 columns (no Sunday) */}
            <div className="grid grid-cols-6 gap-1.5">
              {calendarDaysWithoutSunday.map((day, dayIndex) => {
                const dayIsToday = isToday(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isSaturday = getDay(day) === 6;
                const slots = getDaySlots(day);

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'min-h-[90px] rounded-lg border backdrop-blur-xl transition-all duration-300 p-1.5 group',
                      dayIsToday
                        ? 'border-primary ring-2 ring-inset ring-primary/20 bg-primary/5'
                        : isSaturday
                        ? 'border-border/30 bg-muted/30'
                        : 'border-border/50 bg-card/50',
                      !isCurrentMonth && 'opacity-40'
                    )}
                    style={{ animationDelay: `${dayIndex * 10}ms` }}
                  >
                    {/* Day header */}
                    <div className="flex items-center justify-between mb-1">
                      <div className={cn('text-xs font-bold', dayIsToday ? 'text-primary' : 'text-foreground')}>
                        {format(day, 'd')}
                      </div>
                      {dayIsToday && (
                        <Badge variant="outline" className="text-[9px] py-0 px-1 border-primary/30 text-primary bg-primary/10">
                          Auj.
                        </Badge>
                      )}
                    </div>

                    {/* Slots */}
                    <div className="space-y-1">
                      {slots.map((slot, idx) => {
                        const period = slot.periodes.length === 2 ? 'journee' : slot.periodes[0];
                        const periodColors = {
                          matin: 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300',
                          apres_midi: 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300',
                          journee: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
                        };
                        const periodDotColors = {
                          matin: 'bg-blue-500',
                          apres_midi: 'bg-amber-500',
                          journee: 'bg-emerald-500',
                        };
                        const periodLabels = {
                          matin: 'M',
                          apres_midi: 'AM',
                          journee: 'J',
                        };

                        return (
                          <div
                            key={idx}
                            onClick={() => handleEditClick(slot)}
                            className={cn(
                              'relative group/item w-full flex items-center gap-1 px-1.5 py-1 rounded border',
                              'text-[10px] font-medium transition-all duration-200',
                              'hover:scale-[1.02] hover:shadow-md cursor-pointer text-left',
                              periodColors[period]
                            )}
                          >
                            <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', periodDotColors[period])} />
                            <div className="flex-1 min-w-0">
                              <div className="truncate font-medium">{slot.site}</div>
                            </div>
                            <span className="text-[8px] opacity-70 shrink-0">{periodLabels[period]}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(slot.ids);
                              }}
                              className="absolute -top-1 -right-1 opacity-0 group-hover/item:opacity-100 transition-opacity bg-destructive text-destructive-foreground rounded-full p-0.5 hover:scale-110 shadow-lg"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Add button */}
                    {isCurrentMonth && (
                      <button
                        onClick={() => handleAddClick(day)}
                        className="w-full mt-1 p-1 rounded border border-dashed border-border/50 opacity-0 group-hover:opacity-100 hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 flex items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-primary"
                      >
                        <Plus className="h-2.5 w-2.5" />
                        Ajouter
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 p-2 bg-muted/30 rounded-lg text-[10px] flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-muted-foreground">M = Matin</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-muted-foreground">AM = Après-midi</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">J = Journée</span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Capacite Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="backdrop-blur-xl bg-card/95 border border-border/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center">
                <UserCircle className="h-4 w-4 text-sky-500" />
              </div>
              <span>Ajouter un créneau</span>
            </DialogTitle>
            <DialogDescription className="sr-only">Ajouter un créneau pour {secretaireNom}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Période</label>
              <Select 
                value={selectedPeriode || ''} 
                onValueChange={(value) => setSelectedPeriode(value as 'matin' | 'apres_midi' | 'toute_journee')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une période" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matin">Matin uniquement</SelectItem>
                  <SelectItem value="apres_midi">Après-midi uniquement</SelectItem>
                  <SelectItem value="toute_journee">Toute la journée</SelectItem>
                </SelectContent>
              </Select>
            </div>

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

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleAddCapacite}
                disabled={loading}
                className="bg-primary hover:bg-primary/90"
              >
                Ajouter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Capacite Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="backdrop-blur-xl bg-card/95 border border-border/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center">
                <UserCircle className="h-4 w-4 text-sky-500" />
              </div>
              <span>Modifier l&apos;assignation</span>
            </DialogTitle>
            <DialogDescription className="sr-only">Modifier l&apos;assignation pour {secretaireNom}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Période</label>
              <Select value={selectedPeriode} onValueChange={(value: any) => setSelectedPeriode(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="toute_journee">Journée complète</SelectItem>
                  <SelectItem value="matin">Matin uniquement</SelectItem>
                  <SelectItem value="apres_midi">Après-midi uniquement</SelectItem>
                </SelectContent>
              </Select>
            </div>

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

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleEditSave}
                disabled={loading}
                className="bg-primary hover:bg-primary/90"
              >
                Enregistrer
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
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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
