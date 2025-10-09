import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Trash2, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  sites?: {
    id: string;
    nom: string;
  };
}

export function MedecinMonthCalendar({ open, onOpenChange, medecinId, medecinNom }: MedecinMonthCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [besoins, setBesoins] = useState<BesoinEffectif[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
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
    if (data) setSites(data);
  };

  const fetchBesoins = async () => {
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    const { data } = await supabase
      .from('besoin_effectif')
      .select('*, sites(id, nom)')
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
    
    return besoins.filter(
      b => b.date === dateStr && 
      (b.demi_journee === period || b.demi_journee === 'toute_journee')
    );
  };
  const handleAddBesoin = async (day: number, period: 'matin' | 'apres_midi') => {
    if (!sites.length) return;
    
    setLoading(true);
    try {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
      const dateStr = formatDate(date);

      const { error } = await supabase
        .from('besoin_effectif')
        .insert({
          date: dateStr,
          type: 'medecin',
          medecin_id: medecinId,
          site_id: sites[0].id,
          demi_journee: period,
          actif: true,
        });

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Besoin ajouté",
      });
      fetchBesoins();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible d'ajouter le besoin",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const monthName = currentDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const days = getDaysInMonth();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Calendrier mensuel - {medecinNom}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handlePrevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-normal capitalize min-w-[200px] text-center">
                {monthName}
              </span>
              <Button variant="outline" size="sm" onClick={handleNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-7 gap-1 mt-4">
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => (
            <div key={day} className="text-center font-semibold text-sm py-2 border-b">
              {day}
            </div>
          ))}

          {days.map((day, index) => (
            <div key={index} className="border min-h-[100px] p-1 group">
              {day && (
                <>
                  <div className="text-xs font-semibold mb-1">{day}</div>
                  
                  {/* Matin */}
                  <div className="mb-2">
                    <div className="text-xs text-muted-foreground font-medium mb-1">Matin</div>
                    {(() => {
                      const besoinsList = getBesoinForDate(day, 'matin');
                      return besoinsList.length > 0 ? (
                        besoinsList.map(besoin => (
                          <div key={besoin.id} className="flex items-center gap-1 mb-1">
                            <Select
                              value={besoin.site_id}
                              onValueChange={(value) => handleSiteChange(besoin.id, value, 'matin')}
                              disabled={loading}
                            >
                              <SelectTrigger className="h-auto min-h-[28px] text-xs flex-1 text-left whitespace-normal break-words py-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="z-50">
                                {sites.map(site => (
                                  <SelectItem key={site.id} value={site.id} className="text-xs">
                                    {site.nom}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 shrink-0"
                              onClick={() => handleDelete(besoin.id, 'matin')}
                              disabled={loading}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 w-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleAddBesoin(day, 'matin')}
                          disabled={loading}
                        >
                          + Ajouter
                        </Button>
                      );
                    })()}
                  </div>

                  {/* Après-midi */}
                  <div>
                    <div className="text-xs text-muted-foreground font-medium mb-1">Après-midi</div>
                    {(() => {
                      const besoinsList = getBesoinForDate(day, 'apres_midi');
                      return besoinsList.length > 0 ? (
                        besoinsList.map(besoin => (
                          <div key={besoin.id} className="flex items-center gap-1 mb-1">
                            <Select
                              value={besoin.site_id}
                              onValueChange={(value) => handleSiteChange(besoin.id, value, 'apres_midi')}
                              disabled={loading}
                            >
                              <SelectTrigger className="h-auto min-h-[28px] text-xs flex-1 text-left whitespace-normal break-words py-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="z-50">
                                {sites.map(site => (
                                  <SelectItem key={site.id} value={site.id} className="text-xs">
                                    {site.nom}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 shrink-0"
                              onClick={() => handleDelete(besoin.id, 'apres_midi')}
                              disabled={loading}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 w-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleAddBesoin(day, 'apres_midi')}
                          disabled={loading}
                        >
                          + Ajouter
                        </Button>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
