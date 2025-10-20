import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, startOfWeek, endOfWeek, addMonths, subMonths, isWeekend, getDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, X, Calendar as CalendarIcon } from 'lucide-react';
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto backdrop-blur-xl bg-card/95 border-2 border-primary/20">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Calendrier de {secretaireNom}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Calendrier mensuel de la secrétaire {secretaireNom}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Navigation */}
            <div className="flex items-center justify-between gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevMonth}
                className="backdrop-blur-xl bg-card/95 border-primary/30 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="text-xl font-bold text-foreground">
                {format(currentDate, 'MMMM yyyy', { locale: fr })}
              </div>

              <Button
                variant="outline"
                size="icon"
                onClick={handleNextMonth}
                className="backdrop-blur-xl bg-card/95 border-primary/30 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                onClick={handleToday}
                className="backdrop-blur-xl bg-card/95 border-primary/30 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
              >
                <CalendarIcon className="h-4 w-4 mr-2" />
                Aujourd'hui
              </Button>

              <Button
                onClick={() => setMultipleSlotsOpen(true)}
                className="backdrop-blur-xl bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-white border-0 shadow-lg hover:shadow-xl hover:shadow-primary/20 transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Ajouter plusieurs créneaux
              </Button>
            </div>

            {/* Week days header */}
            <div className="grid grid-cols-7 gap-2">
              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day, idx) => (
                <div
                  key={day}
                  className={cn(
                    'text-center text-xs font-semibold uppercase tracking-wider py-2 rounded-lg',
                    idx >= 5 ? 'text-muted-foreground bg-accent/30' : 'text-foreground bg-muted/50'
                  )}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day, dayIndex) => {
                const dayIsToday = isToday(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isWeekendDay = isWeekend(day);
                const slots = getDaySlots(day);

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'min-h-[140px] rounded-xl border-2 backdrop-blur-xl transition-all duration-300 p-2 group animate-fade-in',
                      dayIsToday
                        ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                        : isWeekendDay
                        ? 'border-accent/40 bg-accent/10'
                        : 'border-border/50 bg-card/50',
                      !isCurrentMonth && 'opacity-40'
                    )}
                    style={{ animationDelay: `${dayIndex * 10}ms` }}
                  >
                    {/* Day header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className={cn('text-sm font-bold', dayIsToday ? 'text-primary' : 'text-foreground')}>
                        {format(day, 'd')}
                      </div>
                      {dayIsToday && (
                        <Badge variant="default" className="text-xs py-0 px-2 bg-primary/20 text-primary border-primary/30">
                          Auj.
                        </Badge>
                      )}
                    </div>

                    {/* Slots */}
                    <div className="space-y-1">
                      {slots.map((slot, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleEditClick(slot)}
                          className={cn(
                            'relative group/item p-2 rounded-lg transition-all duration-200 hover:shadow-md cursor-pointer',
                            slot.periodes.length === 2
                              ? 'border-2 bg-opacity-10'
                              : slot.periodes.includes('matin')
                              ? 'border-l-4 bg-opacity-10'
                              : 'border-r-4 bg-opacity-10'
                          )}
                          style={{
                            borderColor: slot.color,
                            backgroundColor: `${slot.color}15`,
                          }}
                        >
                          <div className="text-xs font-medium truncate" style={{ color: slot.color }}>
                            {slot.site}
                          </div>
                          <div 
                            className="text-[10px] font-medium mt-0.5"
                            style={{ 
                              color: slot.periodes.length === 2 
                                ? slot.color
                                : slot.periodes.includes('matin')
                                ? 'hsl(38, 92%, 50%)'
                                : 'hsl(221, 83%, 53%)'
                            }}
                          >
                            {slot.periodes.length === 2
                              ? 'Journée complète'
                              : slot.periodes.includes('matin')
                              ? 'Matin'
                              : 'Après-midi'}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(slot.ids);
                            }}
                            className="absolute -top-1 -right-1 opacity-0 group-hover/item:opacity-100 transition-opacity bg-destructive text-destructive-foreground rounded-full p-1 hover:scale-110 shadow-lg"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add button */}
                    {isCurrentMonth && (
                      <button
                        onClick={() => handleAddClick(day)}
                        className="w-full mt-2 p-2 rounded-lg border-2 border-dashed border-primary/30 opacity-0 group-hover:opacity-100 hover:border-primary/60 hover:bg-primary/5 transition-all duration-200 flex items-center justify-center gap-1 text-xs font-medium text-primary"
                      >
                        <Plus className="h-3 w-3" />
                        Ajouter
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 p-4 bg-muted/20 rounded-lg text-xs flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-8 h-4 border-2 border-primary rounded" style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }} />
                <span>Journée complète</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-4 border-l-4 border-primary rounded" style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }} />
                <span>Matin uniquement</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-4 border-r-4 border-primary rounded" style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }} />
                <span>Après-midi uniquement</span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Capacite Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="backdrop-blur-xl bg-card/95 border-2 border-primary/20">
          <DialogHeader>
            <DialogTitle>Ajouter un créneau</DialogTitle>
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
                className="bg-gradient-to-r from-primary to-secondary hover:opacity-90"
              >
                Ajouter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Capacite Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="backdrop-blur-xl bg-card/95 border-2 border-primary/20">
          <DialogHeader>
            <DialogTitle>Modifier l&apos;assignation</DialogTitle>
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
                className="bg-gradient-to-r from-primary to-secondary hover:opacity-90"
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
