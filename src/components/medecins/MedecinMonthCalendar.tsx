import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Trash2, Plus, CalendarPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AddMultipleCreneauxDialog } from './AddMultipleCreneauxDialog';

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
  demi_journee: string;
  type_intervention_id?: string;
  sites?: {
    id: string;
    nom: string;
  };
  types_intervention?: {
    id: string;
    nom: string;
  };
}

export function MedecinMonthCalendar({ open, onOpenChange, medecinId, medecinNom }: MedecinMonthCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [besoins, setBesoins] = useState<BesoinEffectif[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<any[]>([]);
  const [blocOperatoireSiteId, setBlocOperatoireSiteId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [addBesoinDialog, setAddBesoinDialog] = useState<{
    open: boolean;
    day: number;
    period: 'matin' | 'apres_midi';
    besoinId?: string;
    step: 'site' | 'intervention';
    selectedSiteId?: string;
  } | null>(null);
  const [multipleCreneauxDialogOpen, setMultipleCreneauxDialogOpen] = useState(false);
  const { toast } = useToast();

  const formatDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

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
    if (data) {
      setSites(data);
      const blocSite = data.find(s => s.nom.toLowerCase().includes('bloc'));
      if (blocSite) setBlocOperatoireSiteId(blocSite.id);
    }

    const { data: typesData } = await supabase
      .from('types_intervention')
      .select('*')
      .eq('actif', true)
      .order('nom');
    if (typesData) setTypesIntervention(typesData);
  };

  const fetchBesoins = async () => {
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    const { data } = await supabase
      .from('besoin_effectif')
      .select('*, sites(id, nom), types_intervention(id, nom)')
      .eq('medecin_id', medecinId)
      .eq('type', 'medecin')
      .gte('date', formatDate(startDate))
      .lte('date', formatDate(endDate))
      .order('date');

    if (data) setBesoins(data);
  };
  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const handleSiteChange = async (besoinId: string, newSiteId: string, period: 'matin' | 'apres_midi') => {
    setLoading(true);
    try {
      const besoin = besoins.find(b => b.id === besoinId);
      if (!besoin) throw new Error('Besoin introuvable');

      if (besoin.demi_journee === 'toute_journee') {
        const otherPeriod = period === 'matin' ? 'apres_midi' : 'matin';
        const { error: updErr } = await supabase
          .from('besoin_effectif')
          .update({ demi_journee: otherPeriod })
          .eq('id', besoinId);
        if (updErr) throw updErr;

        const { error: insErr } = await supabase
          .from('besoin_effectif')
          .insert({
            date: besoin.date,
            type: 'medecin',
            medecin_id: medecinId,
            site_id: newSiteId,
            demi_journee: period,
            actif: true,
          });
        if (insErr) throw insErr;
      } else {
        const { error } = await supabase
          .from('besoin_effectif')
          .update({ site_id: newSiteId })
          .eq('id', besoinId);
        if (error) throw error;
      }

      toast({ title: 'Succès', description: 'Besoin mis à jour' });
      fetchBesoins();
    } catch (error) {
      console.error('Erreur:', error);
      toast({ title: 'Erreur', description: "Impossible de modifier le besoin", variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };
  const handleDelete = async (besoinId: string, period: 'matin' | 'apres_midi') => {
    setLoading(true);
    try {
      const besoin = besoins.find(b => b.id === besoinId);
      if (!besoin) throw new Error('Besoin introuvable');

      if (besoin.demi_journee === 'toute_journee') {
        const otherPeriod = period === 'matin' ? 'apres_midi' : 'matin';
        const { error: updErr } = await supabase
          .from('besoin_effectif')
          .update({ demi_journee: otherPeriod })
          .eq('id', besoinId);
        if (updErr) throw updErr;
      } else {
        const { error } = await supabase
          .from('besoin_effectif')
          .delete()
          .eq('id', besoinId);
        if (error) throw error;
      }

      toast({ title: 'Succès', description: 'Besoin mis à jour' });
      fetchBesoins();
    } catch (error) {
      console.error('Erreur:', error);
      toast({ title: 'Erreur', description: "Impossible de supprimer le besoin", variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };
  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    // Convertir dimanche (0) en 7, et décaler pour avoir lundi = 0
    let startingDayOfWeek = firstDay.getDay();
    startingDayOfWeek = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    return days;
  };

  const getBesoinForDate = (day: number, period: 'matin' | 'apres_midi') => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dateStr = formatDate(date);

    // Préférer les créneaux correspondant exactement à la période
    const sameDate = besoins.filter(b => b.date === dateStr);
    const exact = sameDate.filter(b => b.demi_journee === period);
    if (exact.length > 0) {
      console.info(`getBesoinForDate ${dateStr} [${period}] -> exact x${exact.length}`);
      return exact;
    }

    // Sinon, fallback sur 'toute_journee' (affiché dans les deux colonnes)
    const fullDay = sameDate.filter(b => b.demi_journee === 'toute_journee');
    console.info(`getBesoinForDate ${dateStr} [${period}] -> full-day x${fullDay.length}`);
    return fullDay;
  };
  const handleSiteSelect = async (siteId: string) => {
    if (!addBesoinDialog) return;

    // Si c'est le bloc opératoire, passer à l'étape de sélection du type d'intervention
    if (siteId === blocOperatoireSiteId) {
      setAddBesoinDialog({
        ...addBesoinDialog,
        step: 'intervention',
        selectedSiteId: siteId,
      });
      return;
    }

    // Sinon, créer/modifier directement le besoin sans type d'intervention
    await handleAddBesoin(siteId, null);
  };

  const handleInterventionSelect = async (typeInterventionId: string) => {
    if (!addBesoinDialog?.selectedSiteId) return;
    await handleAddBesoin(addBesoinDialog.selectedSiteId, typeInterventionId);
  };

  const handleAddBesoin = async (siteId: string, typeInterventionId: string | null) => {
    if (!addBesoinDialog) return;
    
    setLoading(true);
    try {
      if (addBesoinDialog.besoinId) {
        // Modification d'un besoin existant
        const besoin = besoins.find(b => b.id === addBesoinDialog.besoinId);
        if (!besoin) throw new Error('Besoin introuvable');

        // Si le besoin est "toute_journee", on doit le scinder
        if (besoin.demi_journee === 'toute_journee') {
          const otherPeriod = addBesoinDialog.period === 'matin' ? 'apres_midi' : 'matin';
          
          // Convertir le besoin existant en l'autre période (celle qu'on ne modifie PAS)
          const { error: updErr } = await supabase
            .from('besoin_effectif')
            .update({ demi_journee: otherPeriod })
            .eq('id', addBesoinDialog.besoinId);
          if (updErr) throw updErr;

          // Créer un nouveau besoin pour la période qu'on modifie
          const { error: insErr } = await supabase
            .from('besoin_effectif')
            .insert({
              date: besoin.date,
              type: 'medecin',
              medecin_id: medecinId,
              site_id: siteId,
              type_intervention_id: typeInterventionId,
              demi_journee: addBesoinDialog.period,
              actif: true,
            });
          if (insErr) throw insErr;
        } else {
          // Besoin simple, on peut le modifier directement
          const { error } = await supabase
            .from('besoin_effectif')
            .update({ 
              site_id: siteId,
              type_intervention_id: typeInterventionId,
            })
            .eq('id', addBesoinDialog.besoinId);
          
          if (error) throw error;
        }
        
        toast({
          title: "Succès",
          description: "Site modifié",
        });
      } else {
        // Création d'un nouveau besoin
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), addBesoinDialog.day);
        const dateStr = formatDate(date);

        const { error } = await supabase
          .from('besoin_effectif')
          .insert({
            date: dateStr,
            type: 'medecin',
            medecin_id: medecinId,
            site_id: siteId,
            type_intervention_id: typeInterventionId,
            demi_journee: addBesoinDialog.period,
            actif: true,
          });

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Besoin ajouté",
        });
      }
      
      fetchBesoins();
      setAddBesoinDialog(null);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: addBesoinDialog.besoinId ? "Impossible de modifier le site" : "Impossible d'ajouter le besoin",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const monthName = currentDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const days = getDaysInMonth();
  
  const isToday = (day: number) => {
    const today = new Date();
    return day === today.getDate() &&
           currentDate.getMonth() === today.getMonth() &&
           currentDate.getFullYear() === today.getFullYear();
  };

  const isWeekend = (index: number) => {
    const dayOfWeek = (index % 7);
    return dayOfWeek === 5 || dayOfWeek === 6; // Sam=5, Dim=6
  };

  const renderBesoinBadge = (besoin: BesoinEffectif, period: 'matin' | 'apres_midi', day: number) => (
    <div key={besoin.id} className="relative group/badge mb-1 animate-fade-in">
      <button
        className="w-full text-left px-3 py-2 rounded-md border border-border bg-card hover:bg-accent hover:border-accent-foreground/20 transition-all text-sm whitespace-normal h-auto min-h-[32px] cursor-pointer"
        title={besoin.sites?.nom || 'Site'}
        onClick={() => setAddBesoinDialog({ 
          open: true, 
          day, 
          period, 
          besoinId: besoin.id,
          step: 'site'
        })}
      >
        <span className="break-words leading-tight font-medium">
          {besoin.sites?.nom || 'Site'}
          {besoin.types_intervention && (
            <span className="text-muted-foreground ml-1">({besoin.types_intervention.nom})</span>
          )}
        </span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="absolute -top-1 -right-1 h-5 w-5 p-0 opacity-0 group-hover/badge:opacity-100 transition-opacity bg-destructive/90 hover:bg-destructive text-destructive-foreground rounded-full z-10"
        onClick={() => handleDelete(besoin.id, period)}
        disabled={loading}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-col gap-4 pb-4">
            <div className="flex items-center gap-3">
              <span className="bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent font-bold">
                Calendrier mensuel
              </span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-muted-foreground font-normal">{medecinNom}</span>
            </div>
            <div className="relative flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" onClick={handlePrevMonth} className="hover:bg-primary/10">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-base font-semibold capitalize min-w-[200px] text-center bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                {monthName}
              </span>
              <Button variant="outline" size="sm" onClick={handleNextMonth} className="hover:bg-primary/10">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setMultipleCreneauxDialogOpen(true)}
                className="gap-2 absolute right-0"
              >
                <CalendarPlus className="h-4 w-4" />
                Ajouter plusieurs créneaux
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-7 gap-2 mt-2">
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day, idx) => (
            <div 
              key={day} 
              className={`text-center font-bold text-sm py-3 rounded-t-lg ${
                idx >= 5 ? 'bg-accent/30' : 'bg-primary/10'
              }`}
            >
              {day}
            </div>
          ))}

          {days.map((day, index) => {
            const isCurrentDay = day && isToday(day);
            const isWeekendDay = isWeekend(index);
            
            return (
              <div 
                key={index} 
                className={`
                  border-2 rounded-lg min-h-[140px] p-2 transition-all duration-200
                  ${day ? 'hover:shadow-lg hover:scale-[1.02]' : ''}
                  ${isWeekendDay ? 'bg-accent/5' : 'bg-card'}
                  ${isCurrentDay ? 'border-primary shadow-md ring-2 ring-primary/20' : 'border-border'}
                  group
                `}
              >
                {day ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm font-bold ${isCurrentDay ? 'text-primary' : ''}`}>
                        {day}
                      </span>
                      {isCurrentDay && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                          Aujourd'hui
                        </Badge>
                      )}
                    </div>
                    
                    {/* Matin */}
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Matin
                      </div>
                      {(() => {
                        const besoinsList = getBesoinForDate(day, 'matin');
                        return besoinsList.length > 0 ? (
                          besoinsList.map(besoin => renderBesoinBadge(besoin, 'matin', day))
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-full text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-primary/10 border-dashed"
                            onClick={() => setAddBesoinDialog({ open: true, day, period: 'matin', step: 'site' })}
                            disabled={loading}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Ajouter
                          </Button>
                        );
                      })()}
                    </div>

                    <Separator className="my-2" />

                    {/* Après-midi */}
                    <div>
                      <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        Après-midi
                      </div>
                      {(() => {
                        const besoinsList = getBesoinForDate(day, 'apres_midi');
                        return besoinsList.length > 0 ? (
                          besoinsList.map(besoin => renderBesoinBadge(besoin, 'apres_midi', day))
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-full text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-primary/10 border-dashed"
                            onClick={() => setAddBesoinDialog({ open: true, day, period: 'apres_midi', step: 'site' })}
                            disabled={loading}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Ajouter
                          </Button>
                        );
                      })()}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Dialog de sélection de site */}
        <Dialog open={addBesoinDialog?.open || false} onOpenChange={(open) => !open && setAddBesoinDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {addBesoinDialog?.step === 'intervention' 
                  ? "Sélectionner un type d'intervention"
                  : addBesoinDialog?.besoinId ? "Changer de site" : "Sélectionner un site"
                }
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-4">
              {addBesoinDialog?.step === 'intervention' ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddBesoinDialog({ ...addBesoinDialog, step: 'site', selectedSiteId: undefined })}
                    className="mb-2"
                  >
                    ← Retour
                  </Button>
                  {typesIntervention.map(type => (
                    <Button
                      key={type.id}
                      variant="outline"
                      className="w-full justify-start text-left h-auto py-3 whitespace-normal"
                      onClick={() => handleInterventionSelect(type.id)}
                      disabled={loading}
                    >
                      {type.nom}
                    </Button>
                  ))}
                </>
              ) : (
                sites.map(site => (
                  <Button
                    key={site.id}
                    variant="outline"
                    className="w-full justify-start text-left h-auto py-3 whitespace-normal"
                    onClick={() => handleSiteSelect(site.id)}
                    disabled={loading}
                  >
                    {site.nom}
                  </Button>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>

      <AddMultipleCreneauxDialog
        open={multipleCreneauxDialogOpen}
        onOpenChange={setMultipleCreneauxDialogOpen}
        medecinId={medecinId}
        onSuccess={fetchBesoins}
      />
    </Dialog>
  );
}
