import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
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
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .order('date');

    if (data) setBesoins(data);
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const handleSiteChange = async (besoinId: string, newSiteId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('besoin_effectif')
        .update({ site_id: newSiteId })
        .eq('id', besoinId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Site modifié",
      });
      fetchBesoins();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de modifier le site",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (besoinId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('id', besoinId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Besoin supprimé",
      });
      fetchBesoins();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer le besoin",
        variant: "destructive",
      });
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
    const startingDayOfWeek = firstDay.getDay();

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
    const dateStr = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
      .toISOString()
      .split('T')[0];
    
    return besoins.find(
      b => b.date === dateStr && 
      (b.demi_journee === period || b.demi_journee === 'toute_journee')
    );
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
          {['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map(day => (
            <div key={day} className="text-center font-semibold text-sm py-2 border-b">
              {day}
            </div>
          ))}

          {days.map((day, index) => (
            <div key={index} className="border min-h-[100px] p-1">
              {day && (
                <>
                  <div className="text-xs font-semibold mb-1">{day}</div>
                  
                  {/* Matin */}
                  <div className="mb-1">
                    <div className="text-xs text-muted-foreground">Matin</div>
                    {(() => {
                      const besoin = getBesoinForDate(day, 'matin');
                      return besoin ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Select
                            value={besoin.site_id}
                            onValueChange={(value) => handleSiteChange(besoin.id, value)}
                            disabled={loading}
                          >
                            <SelectTrigger className="h-6 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {sites.map(site => (
                                <SelectItem key={site.id} value={site.id}>
                                  {site.nom}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => handleDelete(besoin.id)}
                            disabled={loading}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground/50">-</div>
                      );
                    })()}
                  </div>

                  {/* Après-midi */}
                  <div>
                    <div className="text-xs text-muted-foreground">AM</div>
                    {(() => {
                      const besoin = getBesoinForDate(day, 'apres_midi');
                      return besoin ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Select
                            value={besoin.site_id}
                            onValueChange={(value) => handleSiteChange(besoin.id, value)}
                            disabled={loading}
                          >
                            <SelectTrigger className="h-6 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {sites.map(site => (
                                <SelectItem key={site.id} value={site.id}>
                                  {site.nom}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => handleDelete(besoin.id)}
                            disabled={loading}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground/50">-</div>
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
