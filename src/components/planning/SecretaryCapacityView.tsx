import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { EditCapaciteDialog } from './EditCapaciteDialog';

interface CapaciteEffective {
  id: string;
  date: string;
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  secretaire_id?: string;
  site_id?: string;
  secretaire?: {
    first_name: string;
    name: string;
    sites_assignes?: string[];
    medecin_assigne?: {
      first_name: string;
      name: string;
    };
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
  sites_assignes?: string[];
  medecin_assigne?: {
    first_name: string;
    name: string;
  };
}

interface HoraireBase {
  jour_semaine: number;
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
}

interface SecretaireFlexible {
  id: string;
  first_name: string;
  name: string;
  pourcentage_temps: number;
  sites_assignes?: string[];
}

export function SecretaryCapacityView({ capacites, weekDays, canManage, onRefresh }: SecretaryCapacityViewProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedCapacites, setSelectedCapacites] = useState<CapaciteEffective[]>([]);
  const [horairesBase, setHorairesBase] = useState<Map<string, HoraireBase[]>>(new Map());
  const [sites, setSites] = useState<Map<string, string>>(new Map());
  const [secretairesFlexibles, setSecretairesFlexibles] = useState<SecretaireFlexible[]>([]);

  // Récupérer les sites, horaires de base et secrétaires flexibles
  useEffect(() => {
    const fetchData = async () => {
      // Fetch sites
      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true);

      if (sitesData) {
        const sitesMap = new Map<string, string>();
        sitesData.forEach(site => {
          sitesMap.set(site.id, site.nom);
        });
        setSites(sitesMap);
      }

      // Fetch horaires base
      const secretaireIds = Array.from(new Set(
        capacites
          .filter(cap => cap.secretaire_id)
          .map(cap => cap.secretaire_id!)
      ));

      if (secretaireIds.length > 0) {
        const { data, error } = await supabase
          .from('horaires_base_secretaires')
          .select('secretaire_id, jour_semaine, demi_journee')
          .in('secretaire_id', secretaireIds)
          .eq('actif', true);

        if (error) {
          console.error('Erreur lors de la récupération des horaires de base:', error);
        } else {
          const horaireMap = new Map<string, HoraireBase[]>();
          data?.forEach(horaire => {
            if (!horaireMap.has(horaire.secretaire_id)) {
              horaireMap.set(horaire.secretaire_id, []);
            }
            horaireMap.get(horaire.secretaire_id)!.push({
              jour_semaine: horaire.jour_semaine,
              demi_journee: horaire.demi_journee,
            });
          });
          setHorairesBase(horaireMap);
        }
      }

      // Fetch secrétaires flexibles
      const weekStart = format(weekDays[0], 'yyyy-MM-dd');
      const weekEnd = format(weekDays[weekDays.length - 1], 'yyyy-MM-dd');

      const { data: flexibleSecretaries } = await supabase
        .from('secretaires')
        .select('id, first_name, name, pourcentage_temps')
        .eq('horaire_flexible', true)
        .eq('actif', true)
        .not('pourcentage_temps', 'is', null);

      if (flexibleSecretaries) {
        // Vérifier les absences pour chaque secrétaire flexible
        const { data: absences } = await supabase
          .from('absences')
          .select('secretaire_id, date_debut, date_fin')
          .eq('type_personne', 'secretaire')
          .in('statut', ['approuve', 'en_attente'])
          .or(`and(date_debut.lte.${weekEnd},date_fin.gte.${weekStart})`);

        // Filtrer les secrétaires qui n'ont pas déjà leur semaine prise
        const flexiblesDisponibles = flexibleSecretaries.filter(sec => {
          // Vérifier si la secrétaire a des congés cette semaine
          const hasAbsence = absences?.some(abs => abs.secretaire_id === sec.id);
          return !hasAbsence;
        });

        setSecretairesFlexibles(flexiblesDisponibles as SecretaireFlexible[]);
      }
    };

    fetchData();
  }, [capacites, weekDays]);

  // Regrouper les capacités par secrétaire
  const secretariesGroups: SecretaryGroup[] = [];
  const secretariesMap = new Map<string, SecretaryGroup>();

  capacites.forEach(cap => {
    const id = cap.secretaire_id;
    if (!id) return;

    if (!secretariesMap.has(id)) {
      const person = cap.secretaire;
      if (!person) return;

      secretariesMap.set(id, {
        id,
        name: `${person.first_name} ${person.name}`,
        isBackup: false,
        capacites: [],
        sites_assignes: ('sites_assignes' in person) ? (person.sites_assignes || []) : [],
        medecin_assigne: ('medecin_assigne' in person) ? person.medecin_assigne : undefined,
      });
    }

    secretariesMap.get(id)!.capacites.push(cap);
  });

  // Ajouter les secrétaires flexibles (sans capacités assignées mais avec pourcentage)
  secretairesFlexibles.forEach(sec => {
    if (!secretariesMap.has(sec.id)) {
      secretariesMap.set(sec.id, {
        id: sec.id,
        name: `${sec.first_name} ${sec.name}`,
        isBackup: false,
        capacites: [],
        sites_assignes: sec.sites_assignes || [],
      });
    }
  });

  secretariesGroups.push(...Array.from(secretariesMap.values()));

  // Trier par nom
  secretariesGroups.sort((a, b) => a.name.localeCompare(b.name));

  const handleEditClick = (secretary: SecretaryGroup) => {
    setSelectedCapacites(secretary.capacites);
    setEditDialogOpen(true);
  };


  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="p-3 text-left font-semibold">Nom</th>
                  <th className="p-3 text-left font-semibold">
                    <div className="flex items-center gap-2">
                      Jours de présence
                      <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-3 h-3 rounded border-2 border-green-500" />
                          Journée
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-3 h-3 rounded border-2 border-amber-500" />
                          Matin
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-3 h-3 rounded border-2 border-blue-500" />
                          Après-midi
                        </span>
                      </div>
                    </div>
                  </th>
                  {canManage && <th className="p-3 text-right font-semibold w-24">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {secretariesGroups.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 3 : 2} className="p-8 text-center text-muted-foreground">
                      Aucune capacité trouvée pour cette semaine
                    </td>
                  </tr>
                ) : (
                  secretariesGroups.map(secretary => {
                    // Regrouper les capacités par date pour déterminer la période
                    const capacitesParDate = secretary.capacites.reduce((acc, cap) => {
                      if (!acc[cap.date]) {
                        acc[cap.date] = [];
                      }
                      acc[cap.date].push(cap);
                      return acc;
                    }, {} as Record<string, CapaciteEffective[]>);

                    // Construire la liste des jours avec période et site
                    const joursParNom = Object.entries(capacitesParDate).map(([date, capacitesDate]) => {
                      const dateObj = new Date(date);
                      const jourSemaine = format(dateObj, 'EEEE', { locale: fr });
                      
                      // Déterminer la période depuis demi_journee
                      const demiJournees = capacitesDate.map(c => c.demi_journee);
                      
                      let periode: 'matin' | 'apres_midi' | 'journee';
                      if (demiJournees.includes('toute_journee')) {
                        periode = 'journee';
                      } else if (demiJournees.includes('matin') && demiJournees.includes('apres_midi')) {
                        periode = 'journee';
                      } else if (demiJournees.includes('matin')) {
                        periode = 'matin';
                      } else {
                        periode = 'apres_midi';
                      }
                      
                      // Récupérer le site_id si présent (prendre le premier non-null)
                      const siteId = capacitesDate.find(c => c.site_id)?.site_id;
                      const siteNom = siteId ? sites.get(siteId) : null;
                      
                      return {
                        nom: jourSemaine.charAt(0).toUpperCase() + jourSemaine.slice(1),
                        date: format(dateObj, 'yyyy-MM-dd'),
                        periode,
                        siteNom,
                        capacites: capacitesDate
                      };
                    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    // Vérifier si c'est une secrétaire flexible
                    const secretaireFlexible = secretairesFlexibles.find(s => s.id === secretary.id);
                    const isFlexible = !!secretaireFlexible;

                    return (
                      <tr key={secretary.id} className="border-b hover:bg-muted/30">
                        <td className="p-3 font-medium">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              {secretary.name}
                              {secretary.isBackup && (
                                <Badge variant="secondary" className="text-xs">Backup</Badge>
                              )}
                              {isFlexible && secretaireFlexible.pourcentage_temps && (
                                <Badge variant="outline" className="text-xs border-purple-500 text-purple-700">
                                  Flexible {secretaireFlexible.pourcentage_temps}%
                                </Badge>
                              )}
                            </div>
                            {secretary.medecin_assigne && (
                              <span className="text-xs text-muted-foreground">
                                Assigné à: Dr {secretary.medecin_assigne.first_name} {secretary.medecin_assigne.name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {isFlexible && joursParNom.length === 0 ? (
                              <span className="text-xs text-muted-foreground italic">
                                Pas de jours assignés (horaire flexible)
                              </span>
                            ) : (
                              joursParNom.map((jour, idx) => {
                              const borderColor = jour.periode === 'journee' 
                                ? 'border-2 border-green-600' 
                                : jour.periode === 'matin'
                                ? 'border-2 border-blue-600'
                                : 'border-2 border-yellow-600';
                              
                              return (
                                <div key={idx} className="flex flex-col gap-0.5">
                                  <Badge variant="outline" className={`text-xs bg-transparent ${borderColor}`}>
                                    {jour.nom}
                                  </Badge>
                                  {jour.siteNom && (
                                    <span className="text-[10px] text-muted-foreground text-center">
                                      {jour.siteNom}
                                    </span>
                                  )}
                                 </div>
                               );
                             })
                            )}
                          </div>
                        </td>
                        {canManage && (
                          <td className="p-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(secretary)}
                              title="Modifier"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <EditCapaciteDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        capacites={selectedCapacites}
        onSuccess={onRefresh}
      />
    </>
  );
}
