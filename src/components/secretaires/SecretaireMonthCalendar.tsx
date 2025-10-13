import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { ChevronLeft, ChevronRight, Trash2, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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
  demi_journee: string;
  sites?: {
    id: string;
    nom: string;
  };
}

export function SecretaireMonthCalendar({ open, onOpenChange, secretaireId, secretaireNom }: SecretaireMonthCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [capacites, setCapacites] = useState<CapaciteEffective[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [addCapaciteDialog, setAddCapaciteDialog] = useState<{
    open: boolean;
    day: number;
    period: 'matin' | 'apres_midi';
    capaciteId?: string;
  } | null>(null);
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
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    const { data } = await supabase
      .from('capacite_effective')
      .select('*, sites(id, nom)')
      .eq('secretaire_id', secretaireId)
      .gte('date', formatDate(startDate))
      .lte('date', formatDate(endDate))
      .order('date');

    if (data) setCapacites(data);
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const handleSiteChange = async (capaciteId: string, newSiteId: string, period: 'matin' | 'apres_midi') => {
    setLoading(true);
    try {
      const capacite = capacites.find(c => c.id === capaciteId);
      if (!capacite) throw new Error('Capacité introuvable');

      if (capacite.demi_journee === 'toute_journee') {
        const otherPeriod = period === 'matin' ? 'apres_midi' : 'matin';
        const { error: updErr } = await supabase
          .from('capacite_effective')
          .update({ demi_journee: otherPeriod })
          .eq('id', capaciteId);
        if (updErr) throw updErr;

        const { error: insErr } = await supabase
          .from('capacite_effective')
          .insert({
            date: capacite.date,
            secretaire_id: secretaireId,
            site_id: newSiteId,
            demi_journee: period,
            actif: true,
          });
        if (insErr) throw insErr;
      } else {
        const { error } = await supabase
          .from('capacite_effective')
          .update({ site_id: newSiteId })
          .eq('id', capaciteId);
        if (error) throw error;
      }

      toast({ title: 'Succès', description: 'Capacité mise à jour' });
      fetchCapacites();
    } catch (error) {
      console.error('Erreur:', error);
      toast({ title: 'Erreur', description: "Impossible de modifier la capacité", variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (capaciteId: string, period: 'matin' | 'apres_midi') => {
    setLoading(true);
    try {
      const capacite = capacites.find(c => c.id === capaciteId);
      if (!capacite) throw new Error('Capacité introuvable');

      if (capacite.demi_journee === 'toute_journee') {
        const otherPeriod = period === 'matin' ? 'apres_midi' : 'matin';
        const { error: updErr } = await supabase
          .from('capacite_effective')
          .update({ demi_journee: otherPeriod })
          .eq('id', capaciteId);
        if (updErr) throw updErr;
      } else {
        const { error } = await supabase
          .from('capacite_effective')
          .delete()
          .eq('id', capaciteId);
        if (error) throw error;
      }

      toast({ title: 'Succès', description: 'Capacité supprimée' });
      fetchCapacites();
    } catch (error) {
      console.error('Erreur:', error);
      toast({ title: 'Erreur', description: "Impossible de supprimer la capacité", variant: 'destructive' });
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

  const getCapaciteForDate = (day: number, period: 'matin' | 'apres_midi') => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dateStr = formatDate(date);

    const sameDate = capacites.filter(c => c.date === dateStr);
    const exact = sameDate.filter(c => c.demi_journee === period);
    if (exact.length > 0) return exact;

    const fullDay = sameDate.filter(c => c.demi_journee === 'toute_journee');
    return fullDay;
  };

  const handleSiteSelect = async (siteId: string) => {
    if (!addCapaciteDialog) return;
    await handleAddCapacite(siteId);
  };

  const handleAddCapacite = async (siteId: string) => {
    if (!addCapaciteDialog) return;
    
    setLoading(true);
    try {
      if (addCapaciteDialog.capaciteId) {
        // Modification d'une capacité existante
        const capacite = capacites.find(c => c.id === addCapaciteDialog.capaciteId);
        if (!capacite) throw new Error('Capacité introuvable');

        if (capacite.demi_journee === 'toute_journee') {
          const otherPeriod = addCapaciteDialog.period === 'matin' ? 'apres_midi' : 'matin';
          
          const { error: updErr } = await supabase
            .from('capacite_effective')
            .update({ demi_journee: otherPeriod })
            .eq('id', addCapaciteDialog.capaciteId);
          if (updErr) throw updErr;

          const { error: insErr } = await supabase
            .from('capacite_effective')
            .insert({
              date: capacite.date,
              secretaire_id: secretaireId,
              site_id: siteId,
              demi_journee: addCapaciteDialog.period,
              actif: true,
            });
          if (insErr) throw insErr;
        } else {
          const { error } = await supabase
            .from('capacite_effective')
            .update({ site_id: siteId })
            .eq('id', addCapaciteDialog.capaciteId);
          
          if (error) throw error;
        }
        
        toast({
          title: "Succès",
          description: "Site modifié",
        });
      } else {
        // Création d'une nouvelle capacité
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), addCapaciteDialog.day);
        const dateStr = formatDate(date);

        const { error } = await supabase
          .from('capacite_effective')
          .insert({
            date: dateStr,
            secretaire_id: secretaireId,
            site_id: siteId,
            demi_journee: addCapaciteDialog.period,
            actif: true,
          });

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Capacité ajoutée",
        });
      }
      
      fetchCapacites();
      setAddCapaciteDialog(null);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: addCapaciteDialog.capaciteId ? "Impossible de modifier le site" : "Impossible d'ajouter la capacité",
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
    return dayOfWeek === 5 || dayOfWeek === 6;
  };

  const renderCapaciteBadge = (capacite: CapaciteEffective, period: 'matin' | 'apres_midi', day: number) => (
    <div key={capacite.id} className="relative group/badge mb-1 animate-fade-in">
      <button
        className="w-full text-left px-3 py-2 rounded-md border border-border bg-card hover:bg-accent hover:border-accent-foreground/20 transition-all text-sm whitespace-normal h-auto min-h-[32px] cursor-pointer"
        title={capacite.sites?.nom || 'Site'}
        onClick={() => setAddCapaciteDialog({ 
          open: true, 
          day, 
          period, 
          capaciteId: capacite.id
        })}
      >
        <span className="break-words leading-tight font-medium">
          {capacite.sites?.nom || 'Site'}
        </span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="absolute -top-1 -right-1 h-5 w-5 p-0 opacity-0 group-hover/badge:opacity-100 transition-opacity bg-destructive/90 hover:bg-destructive text-destructive-foreground rounded-full z-10"
        onClick={() => handleDelete(capacite.id, period)}
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
              <span className="text-muted-foreground font-normal">{secretaireNom}</span>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" onClick={handlePrevMonth} className="hover:bg-primary/10">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-base font-semibold capitalize min-w-[200px] text-center bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                {monthName}
              </span>
              <Button variant="outline" size="sm" onClick={handleNextMonth} className="hover:bg-primary/10">
                <ChevronRight className="h-4 w-4" />
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
                        const capacitesList = getCapaciteForDate(day, 'matin');
                        return capacitesList.length > 0 ? (
                          capacitesList.map(capacite => renderCapaciteBadge(capacite, 'matin', day))
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-full text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-primary/10 border-dashed"
                            onClick={() => setAddCapaciteDialog({ open: true, day, period: 'matin' })}
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
                        const capacitesList = getCapaciteForDate(day, 'apres_midi');
                        return capacitesList.length > 0 ? (
                          capacitesList.map(capacite => renderCapaciteBadge(capacite, 'apres_midi', day))
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-full text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-primary/10 border-dashed"
                            onClick={() => setAddCapaciteDialog({ open: true, day, period: 'apres_midi' })}
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

        {/* Dialog pour sélectionner le site */}
        {addCapaciteDialog && (
          <Dialog open={addCapaciteDialog.open} onOpenChange={(open) => !open && setAddCapaciteDialog(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {addCapaciteDialog.capaciteId ? 'Modifier le site' : 'Sélectionner un site'}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
                {sites.map(site => (
                  <Button
                    key={site.id}
                    variant="outline"
                    className="h-auto py-3 px-4 text-left justify-start hover:bg-primary/10"
                    onClick={() => handleSiteSelect(site.id)}
                    disabled={loading}
                  >
                    {site.nom}
                  </Button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
