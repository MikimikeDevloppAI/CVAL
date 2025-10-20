import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, startOfWeek, endOfWeek, addMonths, subMonths, isWeekend } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, X, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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

interface MedecinMonthCalendarProps {
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
  sites?: { nom: string };
  types_intervention?: { nom: string };
}

interface Site {
  id: string;
  nom: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
}

interface DaySlot {
  site: string;
  siteId: string;
  periodes: ('matin' | 'apres_midi')[];
  ids: string[];
  color: string;
  typeIntervention?: string;
}

export function MedecinMonthCalendar({ open, onOpenChange, medecinId, medecinNom }: MedecinMonthCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [besoins, setBesoins] = useState<BesoinEffectif[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [loading, setLoading] = useState(false);

  // Add dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');

  // Edit dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<DaySlot | null>(null);

  // Delete dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [besoinToDelete, setBesoinToDelete] = useState<string | null>(null);

  // Multiple slots dialog
  const [multipleSlotsOpen, setMultipleSlotsOpen] = useState(false);

  const SITE_COLORS = [
    'hsl(var(--planning-event-teal))',
    'hsl(var(--planning-event-blue))',
    'hsl(var(--planning-event-purple))',
    'hsl(var(--planning-event-orange))',
    'hsl(var(--planning-event-green))',
  ];

  useEffect(() => {
    if (open) {
      fetchSites();
      fetchBesoins();
    }
  }, [open, currentDate, medecinId]);

  const fetchSites = async () => {
    const { data } = await supabase
      .from('sites')
      .select('id, nom')
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
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);

    const { data } = await supabase
      .from('besoin_effectif')
      .select(`
        id,
        date,
        site_id,
        demi_journee,
        type_intervention_id,
        sites(nom),
        types_intervention(nom)
      `)
      .eq('medecin_id', medecinId)
      .gte('date', format(monthStart, 'yyyy-MM-dd'))
      .lte('date', format(monthEnd, 'yyyy-MM-dd'))
      .order('date')
      .order('demi_journee');

    if (data) setBesoins(data as any);
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
    const matin = besoins.filter(
      (b) => isSameDay(new Date(b.date), date) && b.demi_journee === 'matin'
    );
    const apresmidi = besoins.filter(
      (b) => isSameDay(new Date(b.date), date) && b.demi_journee === 'apres_midi'
    );

    const slots: DaySlot[] = [];

    // Grouper par site + type intervention pour unifier les slots
    const siteIds = new Set([...matin.map((m) => m.site_id), ...apresmidi.map((a) => a.site_id)]);

    siteIds.forEach((siteId) => {
      const matinForSite = matin.find((m) => m.site_id === siteId);
      const apresmidiForSite = apresmidi.find((a) => a.site_id === siteId);

      // Vérifier si même type d'intervention
      const sameType =
        matinForSite &&
        apresmidiForSite &&
        matinForSite.type_intervention_id === apresmidiForSite.type_intervention_id;

      if (matinForSite && apresmidiForSite && sameType) {
        // Même site + même type → 1 ligne
        slots.push({
          site: matinForSite.sites?.nom || 'Site',
          siteId,
          periodes: ['matin', 'apres_midi'],
          ids: [matinForSite.id, apresmidiForSite.id],
          color: getSiteColor(siteId),
          typeIntervention: matinForSite.types_intervention?.nom,
        });
      } else {
        // Lignes séparées
        if (matinForSite) {
          slots.push({
            site: matinForSite.sites?.nom || 'Site',
            siteId,
            periodes: ['matin'],
            ids: [matinForSite.id],
            color: getSiteColor(siteId),
            typeIntervention: matinForSite.types_intervention?.nom,
          });
        }
        if (apresmidiForSite) {
          slots.push({
            site: apresmidiForSite.sites?.nom || 'Site',
            siteId,
            periodes: ['apres_midi'],
            ids: [apresmidiForSite.id],
            color: getSiteColor(siteId),
            typeIntervention: apresmidiForSite.types_intervention?.nom,
          });
        }
      }
    });

    return slots;
  };

  const handleAddClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedSiteId('');
    setSelectedTypeInterventionId('');
    setAddDialogOpen(true);
  };

  const handleAddBesoin = async () => {
    if (!selectedDate || !selectedSiteId) {
      toast.error('Veuillez sélectionner un site');
      return;
    }

    setLoading(true);

    // Ajouter matin et après-midi pour une journée complète
    const { error: errorMatin } = await supabase.from('besoin_effectif').insert({
      type: 'medecin',
      medecin_id: medecinId,
      date: format(selectedDate, 'yyyy-MM-dd'),
      site_id: selectedSiteId,
      demi_journee: 'matin',
      type_intervention_id: selectedTypeInterventionId || null,
    });

    const { error: errorApresmidi } = await supabase.from('besoin_effectif').insert({
      type: 'medecin',
      medecin_id: medecinId,
      date: format(selectedDate, 'yyyy-MM-dd'),
      site_id: selectedSiteId,
      demi_journee: 'apres_midi',
      type_intervention_id: selectedTypeInterventionId || null,
    });

    if (errorMatin || errorApresmidi) {
      toast.error("Erreur lors de l'ajout");
    } else {
      toast.success('Journée complète ajoutée');
      fetchBesoins();
      setAddDialogOpen(false);
    }
    setLoading(false);
  };

  const handleDeleteClick = (besoinIds: string[]) => {
    setBesoinToDelete(besoinIds.join(','));
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!besoinToDelete) return;

    setLoading(true);
    const ids = besoinToDelete.split(',');

    for (const id of ids) {
      await supabase.from('besoin_effectif').delete().eq('id', id);
    }

    toast.success('Créneau supprimé');
    fetchBesoins();
    setLoading(false);
    setDeleteDialogOpen(false);
    setBesoinToDelete(null);
  };

  const handleEditClick = (slot: DaySlot) => {
    setEditingSlot(slot);
    setSelectedSiteId(slot.siteId);
    setSelectedTypeInterventionId(''); // Will be set from existing data if available
    
    // Find if there's a type intervention on the first besoin
    const firstBesoin = besoins.find(b => slot.ids.includes(b.id));
    if (firstBesoin?.type_intervention_id) {
      setSelectedTypeInterventionId(firstBesoin.type_intervention_id);
    }
    
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editingSlot || !selectedSiteId) {
      toast.error('Veuillez sélectionner un site');
      return;
    }

    setLoading(true);

    // Update all besoins in the slot
    for (const id of editingSlot.ids) {
      const { error } = await supabase
        .from('besoin_effectif')
        .update({
          site_id: selectedSiteId,
          type_intervention_id: selectedTypeInterventionId || null,
        })
        .eq('id', id);

      if (error) {
        toast.error('Erreur lors de la modification');
        setLoading(false);
        return;
      }
    }

    toast.success('Créneau modifié');
    fetchBesoins();
    setEditDialogOpen(false);
    setEditingSlot(null);
    setLoading(false);
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
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto backdrop-blur-xl bg-card/95 border-2 border-planning-teal/30">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-planning-teal to-planning-blue bg-clip-text text-transparent">
              Calendrier de {medecinNom}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Calendrier mensuel du médecin {medecinNom}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Navigation */}
            <div className="flex items-center justify-between gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevMonth}
                className="backdrop-blur-xl bg-card/95 border-planning-teal/30 hover:border-planning-teal/60 hover:shadow-lg hover:shadow-planning-teal/10 transition-all duration-300"
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
                className="backdrop-blur-xl bg-card/95 border-planning-teal/30 hover:border-planning-teal/60 hover:shadow-lg hover:shadow-planning-teal/10 transition-all duration-300"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                onClick={handleToday}
                className="backdrop-blur-xl bg-card/95 border-planning-teal/30 hover:border-planning-teal/60 hover:shadow-lg hover:shadow-planning-teal/10 transition-all duration-300"
              >
                <CalendarIcon className="h-4 w-4 mr-2" />
                Aujourd'hui
              </Button>

              <Button
                onClick={() => setMultipleSlotsOpen(true)}
                className="backdrop-blur-xl bg-gradient-to-r from-planning-teal to-planning-blue hover:opacity-90 text-white border-0 shadow-lg hover:shadow-xl hover:shadow-planning-teal/20 transition-all duration-300"
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
                        ? 'border-planning-teal ring-2 ring-planning-teal/30 bg-planning-teal/5'
                        : isWeekendDay
                        ? 'border-accent/40 bg-accent/10'
                        : 'border-border/50 bg-card/50',
                      !isCurrentMonth && 'opacity-40'
                    )}
                    style={{ animationDelay: `${dayIndex * 10}ms` }}
                  >
                    {/* Day header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className={cn('text-sm font-bold', dayIsToday ? 'text-planning-teal' : 'text-foreground')}>
                        {format(day, 'd')}
                      </div>
                      {dayIsToday && (
                        <Badge variant="default" className="text-xs py-0 px-2 bg-planning-teal/20 text-planning-teal border-planning-teal/30">
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
                          {slot.typeIntervention && (
                            <div className="text-[10px] text-muted-foreground truncate">
                              {slot.typeIntervention}
                            </div>
                          )}
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
                        className="w-full mt-2 p-2 rounded-lg border-2 border-dashed border-planning-teal/30 opacity-0 group-hover:opacity-100 hover:border-planning-teal/60 hover:bg-planning-teal/5 transition-all duration-200 flex items-center justify-center gap-1 text-xs font-medium text-planning-teal"
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
                <div className="w-8 h-4 border-2 border-planning-teal rounded" style={{ backgroundColor: 'hsl(var(--planning-event-teal) / 0.1)' }} />
                <span>Journée complète</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-4 border-l-4 border-planning-teal rounded" style={{ backgroundColor: 'hsl(var(--planning-event-teal) / 0.1)' }} />
                <span>Matin uniquement</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-4 border-r-4 border-planning-teal rounded" style={{ backgroundColor: 'hsl(var(--planning-event-teal) / 0.1)' }} />
                <span>Après-midi uniquement</span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Besoin Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="backdrop-blur-xl bg-card/95 border-2 border-planning-teal/30">
          <DialogHeader>
            <DialogTitle>Ajouter une journée</DialogTitle>
            <DialogDescription className="sr-only">Ajouter une journée complète pour {medecinNom}</DialogDescription>
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

            <div>
              <label className="text-sm font-medium">Type d&apos;intervention (optionnel)</label>
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

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleAddBesoin}
                disabled={loading}
                className="bg-gradient-to-r from-planning-teal to-planning-blue hover:opacity-90"
              >
                Ajouter journée complète
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Besoin Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="backdrop-blur-xl bg-card/95 border-2 border-planning-teal/30">
          <DialogHeader>
            <DialogTitle>Modifier l&apos;assignation</DialogTitle>
            <DialogDescription className="sr-only">Modifier l&apos;assignation pour {medecinNom}</DialogDescription>
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

            <div>
              <label className="text-sm font-medium">Type d&apos;intervention (optionnel)</label>
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

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleEditSave}
                disabled={loading}
                className="bg-gradient-to-r from-planning-teal to-planning-blue hover:opacity-90"
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
        medecinId={medecinId}
        onSuccess={fetchBesoins}
      />
    </>
  );
}
