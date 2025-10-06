import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, X, UserCog } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CapaciteEffective {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  secretaire_id?: string;
  backup_id?: string;
  secretaire?: {
    first_name: string;
    name: string;
    specialites: string[];
  };
  backup?: {
    first_name: string;
    name: string;
    specialites: string[];
  };
}

interface SecretaryCapacityViewProps {
  capacites: CapaciteEffective[];
  weekDays: Date[];
  canManage: boolean;
  onRefresh: () => void;
}

interface SecretaryGroup {
  id: string;
  name: string;
  isBackup: boolean;
  capacites: CapaciteEffective[];
  specialites: string[];
}

interface HoraireBase {
  jour_semaine: number;
  heure_debut: string;
  heure_fin: string;
}

export function SecretaryCapacityView({ capacites, weekDays, canManage, onRefresh }: SecretaryCapacityViewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSecretary, setSelectedSecretary] = useState<SecretaryGroup | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'journee'>('journee');
  const [horairesBase, setHorairesBase] = useState<Map<string, HoraireBase[]>>(new Map());

  // Récupérer les horaires de base pour toutes les secrétaires
  useEffect(() => {
    const fetchHorairesBase = async () => {
      const secretaireIds = Array.from(new Set(
        capacites
          .filter(cap => cap.secretaire_id)
          .map(cap => cap.secretaire_id!)
      ));

      if (secretaireIds.length === 0) return;

      const { data, error } = await supabase
        .from('horaires_base_secretaires')
        .select('secretaire_id, jour_semaine, heure_debut, heure_fin')
        .in('secretaire_id', secretaireIds)
        .eq('actif', true);

      if (error) {
        console.error('Erreur lors de la récupération des horaires de base:', error);
        return;
      }

      const horaireMap = new Map<string, HoraireBase[]>();
      data?.forEach(horaire => {
        if (!horaireMap.has(horaire.secretaire_id)) {
          horaireMap.set(horaire.secretaire_id, []);
        }
        horaireMap.get(horaire.secretaire_id)!.push({
          jour_semaine: horaire.jour_semaine,
          heure_debut: horaire.heure_debut,
          heure_fin: horaire.heure_fin,
        });
      });

      setHorairesBase(horaireMap);
    };

    fetchHorairesBase();
  }, [capacites]);

  // Regrouper les capacités par secrétaire
  const secretariesGroups: SecretaryGroup[] = [];
  const secretariesMap = new Map<string, SecretaryGroup>();

  capacites.forEach(cap => {
    const id = cap.secretaire_id || cap.backup_id;
    if (!id) return;

    if (!secretariesMap.has(id)) {
      const person = cap.secretaire || cap.backup;
      if (!person) return;

      secretariesMap.set(id, {
        id,
        name: `${person.first_name} ${person.name}`,
        isBackup: !!cap.backup_id,
        capacites: [],
        specialites: person.specialites || [],
      });
    }

    secretariesMap.get(id)!.capacites.push(cap);
  });

  secretariesGroups.push(...Array.from(secretariesMap.values()));

  // Trier par nom
  secretariesGroups.sort((a, b) => a.name.localeCompare(b.name));

  const handleAddDay = (secretary: SecretaryGroup) => {
    setSelectedSecretary(secretary);
    setSelectedDate('');
    setSelectedPeriod('journee');
    setDialogOpen(true);
  };

  const handleRemoveCapacity = async (capacityId: string) => {
    try {
      const { error } = await supabase
        .from('capacite_effective')
        .delete()
        .eq('id', capacityId);

      if (error) throw error;

      toast.success('Capacité supprimée avec succès');
      onRefresh();
    } catch (error) {
      console.error('Erreur:', error);
      toast.error('Erreur lors de la suppression de la capacité');
    }
  };

  const handleSaveNewDay = async () => {
    if (!selectedSecretary || !selectedDate) {
      toast.error('Veuillez sélectionner une date');
      return;
    }

    try {
      let heureDebut: string;
      let heureFin: string;

      if (selectedPeriod === 'journee') {
        heureDebut = '07:30:00';
        heureFin = '17:00:00';
      } else if (selectedPeriod === 'matin') {
        heureDebut = '07:30:00';
        heureFin = '12:00:00';
      } else {
        heureDebut = '13:00:00';
        heureFin = '17:00:00';
      }

      const insertData: any = {
        date: selectedDate,
        heure_debut: heureDebut,
        heure_fin: heureFin,
      };

      if (selectedSecretary.isBackup) {
        insertData.backup_id = selectedSecretary.id;
      } else {
        insertData.secretaire_id = selectedSecretary.id;
      }

      const { error } = await supabase
        .from('capacite_effective')
        .insert(insertData);

      if (error) throw error;

      toast.success('Jour ajouté avec succès');
      setDialogOpen(false);
      onRefresh();
    } catch (error) {
      console.error('Erreur:', error);
      toast.error('Erreur lors de l\'ajout du jour');
    }
  };

  // Vérifier si une capacité est un ajout manuel (hors horaires de base)
  const isManualAddition = (cap: CapaciteEffective): boolean => {
    if (!cap.secretaire_id) return false;
    
    const horaires = horairesBase.get(cap.secretaire_id);
    if (!horaires || horaires.length === 0) return true;

    const date = new Date(cap.date);
    const jourSemaine = date.getDay() === 0 ? 7 : date.getDay(); // Convertir dimanche (0) en 7

    // Vérifier si ce jour/horaire correspond à un horaire de base
    const matchingHoraire = horaires.find(h => 
      h.jour_semaine === jourSemaine &&
      h.heure_debut === cap.heure_debut &&
      h.heure_fin === cap.heure_fin
    );

    return !matchingHoraire;
  };

  // Obtenir les dates disponibles (jours où la secrétaire ne travaille pas encore)
  // Exclure samedi (6) et dimanche (0)
  const getAvailableDates = (secretary: SecretaryGroup) => {
    const assignedDates = new Set(secretary.capacites.map(c => c.date));
    return weekDays.filter(day => {
      const dayOfWeek = day.getDay();
      return !assignedDates.has(format(day, 'yyyy-MM-dd')) && dayOfWeek !== 0 && dayOfWeek !== 6;
    });
  };

  return (
    <>
      <div className="space-y-4">
        {secretariesGroups.map(secretary => (
          <Card key={secretary.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserCog className="h-5 w-5 text-primary" />
                  <span>{secretary.name}</span>
                  {secretary.isBackup && (
                    <Badge variant="secondary">Backup</Badge>
                  )}
                </div>
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddDay(secretary)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un jour
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {secretary.capacites.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Aucune capacité assignée cette semaine
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {secretary.capacites
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map(cap => (
                        <div
                          key={cap.id}
                          className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                {format(new Date(cap.date), 'EEEE d MMM', { locale: fr })}
                              </span>
                              {isManualAddition(cap) && (
                                <Badge 
                                  variant="outline" 
                                  className="h-5 px-1.5 bg-green-500/10 text-green-600 border-green-500/20"
                                >
                                  <Plus className="h-3 w-3" />
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {cap.heure_debut.slice(0, 5)} - {cap.heure_fin.slice(0, 5)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {cap.heure_debut === '07:30:00' && cap.heure_fin === '12:00:00' 
                                ? 'Matin'
                                : cap.heure_debut === '13:00:00' && cap.heure_fin === '17:00:00'
                                ? 'Après-midi'
                                : cap.heure_debut === '07:30:00' && cap.heure_fin === '17:00:00'
                                ? 'Journée complète'
                                : 'Autre horaire'}
                            </div>
                          </div>
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleRemoveCapacity(cap.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {secretariesGroups.length === 0 && (
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground">
                Aucune capacité trouvée pour cette semaine
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialog pour ajouter un jour */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un jour pour {selectedSecretary?.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Date</label>
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une date" />
                </SelectTrigger>
                <SelectContent>
                  {selectedSecretary && getAvailableDates(selectedSecretary).map(day => (
                    <SelectItem key={day.toISOString()} value={format(day, 'yyyy-MM-dd')}>
                      {format(day, 'EEEE d MMMM yyyy', { locale: fr })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Période</label>
              <Select value={selectedPeriod} onValueChange={(v) => setSelectedPeriod(v as 'matin' | 'apres_midi' | 'journee')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matin">Matin (07:30 - 12:00)</SelectItem>
                  <SelectItem value="apres_midi">Après-midi (13:00 - 17:00)</SelectItem>
                  <SelectItem value="journee">Journée complète (07:30 - 17:00)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSaveNewDay} disabled={!selectedDate}>
                Ajouter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
