import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Mail, Phone, Trash2, Calendar, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle, ContactInfo } from '@/components/ui/modern-card';
import { SecretaireForm } from '@/components/secretaires/SecretaireForm';
import { QuickEditSitesDialog } from '@/components/secretaires/QuickEditSitesDialog';
import { QuickEditMedecinDialog } from '@/components/secretaires/QuickEditMedecinDialog';
import { EditHoraireSecretaireDialog } from '@/components/secretaires/EditHoraireSecretaireDialog';
import { SecretaireMonthCalendar } from '@/components/secretaires/SecretaireMonthCalendar';
import { GlobalCalendarView } from '@/components/secretaires/GlobalCalendarView';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface Secretaire {
  id: string;
  first_name?: string;
  name?: string;
  email?: string;
  phone_number?: string;
  sites_assignes_details?: { nom: string; priorite?: string }[];
  medecins_assignes_details?: { first_name: string; name: string; priorite?: string }[];
  horaires_base_secretaires?: { 
    id: string;
    jour_semaine: number; 
    demi_journee?: string; 
    actif?: boolean;
    site_id?: string;
    date_debut?: string;
    date_fin?: string;
    alternance_type?: 'hebdomadaire' | 'une_sur_deux' | 'une_sur_trois' | 'une_sur_quatre';
    alternance_semaine_modulo?: number;
    sites?: { nom: string } | null;
  }[];
  horaires?: { jour: number; jourTravaille: boolean; demiJournee: string; actif: boolean }[];
  profile_id?: string;
  prefere_port_en_truie?: boolean;
  flexible_jours_supplementaires?: boolean;
  nombre_jours_supplementaires?: number;
  horaire_flexible?: boolean;
  pourcentage_temps?: number;
  actif?: boolean;
  personnel_bloc_operatoire?: boolean;
  assignation_administrative?: boolean;
  anesthesiste?: boolean;
  instrumentaliste?: boolean;
  aide_de_salle?: boolean;
  bloc_ophtalmo_accueil?: boolean;
  bloc_dermato_accueil?: boolean;
}

export default function SecretairesPage() {
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedSecretaire, setSelectedSecretaire] = useState<Secretaire | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isHoraireDialogOpen, setIsHoraireDialogOpen] = useState(false);
  const [selectedJour, setSelectedJour] = useState<number>(1);
  const [selectedHoraire, setSelectedHoraire] = useState<any>(null);
  const [editingSecretaireId, setEditingSecretaireId] = useState<string>('');
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedSecretaireForCalendar, setSelectedSecretaireForCalendar] = useState<{ id: string; nom: string } | null>(null);
  const [globalCalendarOpen, setGlobalCalendarOpen] = useState(false);
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const fetchSecretaires = async () => {
    try {
      // D'abord récupérer les secrétaires avec leurs horaires de base
      const { data: secretairesData, error: secretairesError } = await supabase
        .from('secretaires')
        .select(`
          id,
          first_name,
          name,
          email,
          phone_number,
          profile_id,
          prefere_port_en_truie,
          flexible_jours_supplementaires,
          nombre_jours_supplementaires,
          horaire_flexible,
          pourcentage_temps,
          personnel_bloc_operatoire,
          assignation_administrative,
          anesthesiste,
          instrumentaliste,
          aide_de_salle,
          bloc_ophtalmo_accueil,
          bloc_dermato_accueil,
          actif,
          horaires_base_secretaires (
            id,
            jour_semaine,
            demi_journee,
            actif,
            site_id,
            date_debut,
            date_fin,
            alternance_type,
            alternance_semaine_modulo
          )
        `);

      if (secretairesError) {
        console.error('Erreur de requête secrétaires:', secretairesError);
        throw secretairesError;
      }

      // Ensuite enrichir avec les noms des sites et mapper les horaires
      if (secretairesData && secretairesData.length > 0) {
        const secretairesWithSites = await Promise.all(
          secretairesData.map(async (secretaire: any) => {
            let sites_assignes_details = [];
            
            // Récupérer les sites assignés depuis la nouvelle table secretaires_sites
            const { data: secretairesSitesData } = await supabase
              .from('secretaires_sites')
              .select('site_id, priorite, sites(nom)')
              .eq('secretaire_id', secretaire.id);
            
            if (secretairesSitesData && secretairesSitesData.length > 0) {
              sites_assignes_details = secretairesSitesData.map((ss: any) => ({
                nom: ss.sites?.nom || '',
                priorite: ss.priorite
              }));
            }

            // Récupérer les médecins assignés depuis la nouvelle table secretaires_medecins
            let medecins_assignes_details = [];
            const { data: secretairesMedecinsData, error: medecinsError } = await supabase
              .from('secretaires_medecins')
              .select('medecin_id, priorite')
              .eq('secretaire_id', secretaire.id);
            
            if (medecinsError) {
              console.error('Erreur lors du chargement des médecins assignés:', medecinsError);
            }
            
            if (secretairesMedecinsData && secretairesMedecinsData.length > 0) {
              const medecinIds = secretairesMedecinsData.map((sm: any) => sm.medecin_id).filter(Boolean);
              let medecinsMap: Record<string, { first_name: string; name: string }> = {};

              if (medecinIds.length > 0) {
                const { data: medecinsData, error: medecinsNamesError } = await supabase
                  .from('medecins')
                  .select('id, first_name, name')
                  .in('id', medecinIds);

                if (medecinsNamesError) {
                  console.error('Erreur lors du chargement des noms des médecins:', medecinsNamesError);
                } else if (medecinsData) {
                  medecinsMap = Object.fromEntries(
                    medecinsData.map((m: any) => [m.id, { first_name: m.first_name || '', name: m.name || '' }])
                  );
                }
              }

              medecins_assignes_details = secretairesMedecinsData.map((sm: any) => ({
                first_name: medecinsMap[sm.medecin_id]?.first_name || '',
                name: medecinsMap[sm.medecin_id]?.name || '',
                priorite: sm.priorite
              }));
            }

            // Enrichir les horaires avec les noms des sites
            const horairesEnrichis = await Promise.all(
              (secretaire.horaires_base_secretaires || []).map(async (horaire: any) => {
                if (horaire.site_id) {
                  const { data: siteData } = await supabase
                    .from('sites')
                    .select('nom')
                    .eq('id', horaire.site_id)
                    .single();
                  
                  return {
                    ...horaire,
                    sites: siteData
                  };
                }
                return horaire;
              })
            );

            // Mapper les horaires pour le formulaire
            const horaires = [];
            for (let jour = 1; jour <= 5; jour++) {
              const horaireExistant = horairesEnrichis?.find(
                (h: any) => h.jour_semaine === jour
              );
              
              if (horaireExistant) {
                horaires.push({
                  jour,
                  jourTravaille: true,
                  demiJournee: horaireExistant.demi_journee || 'toute_journee',
                  actif: horaireExistant.actif !== false
                });
              } else {
                horaires.push({
                  jour,
                  jourTravaille: false,
                  demiJournee: 'toute_journee',
                  actif: true
                });
              }
            }
            
            return {
              ...secretaire,
              horaires_base_secretaires: horairesEnrichis,
              sites_assignes_details,
              medecins_assignes_details,
              horaires
            };
          })
        );
        setSecretaires(secretairesWithSites as Secretaire[]);
      } else {
        setSecretaires([]);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des secrétaires:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les secrétaires",
        variant: "destructive",
      });
      setSecretaires([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecretaires();
  }, []);

  const handleToggleStatus = async (secretaireId: string, currentStatus: boolean, skipConfirmation: boolean = false) => {
    // Si on désactive et qu'on n'a pas skip la confirmation, on ne fait rien ici
    // La confirmation sera gérée par l'AlertDialog
    if (currentStatus && !skipConfirmation) {
      return;
    }

    try {
      const { error } = await supabase
        .from('secretaires')
        .update({ actif: !currentStatus })
        .eq('id', secretaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: `Secrétaire ${!currentStatus ? 'activée' : 'désactivée'} avec succès`,
      });
      
      fetchSecretaires();
    } catch (error) {
      console.error('Erreur lors de la modification du statut:', error);
      toast({
        title: "Erreur",
        description: "Impossible de modifier le statut de la secrétaire",
        variant: "destructive",
      });
    }
  };

  const filteredSecretaires = secretaires
    .filter(secretaire => {
      const prenom = secretaire.first_name || '';
      const nom = secretaire.name || '';
      const email = secretaire.email || '';
      const telephone = secretaire.phone_number || '';
      
      const matchesSearch = prenom.toLowerCase().includes(searchTerm.toLowerCase()) ||
             nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
             email.toLowerCase().includes(searchTerm.toLowerCase()) ||
             telephone.toLowerCase().includes(searchTerm.toLowerCase()) ||
             secretaire.id.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = showInactive ? secretaire.actif === false : secretaire.actif !== false;
      
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const prenomA = (a.first_name || '').toLowerCase();
      const prenomB = (b.first_name || '').toLowerCase();
      return prenomA.localeCompare(prenomB);
    });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedSecretaire(null);
    fetchSecretaires();
  };

  const handleAddHoraire = (secretaireId: string, jour: number) => {
    setEditingSecretaireId(secretaireId);
    setSelectedJour(jour);
    setSelectedHoraire(null);
    setIsHoraireDialogOpen(true);
  };

  const handleEditHoraire = (secretaireId: string, horaire: any) => {
    setEditingSecretaireId(secretaireId);
    setSelectedJour(horaire.jour_semaine);
    setSelectedHoraire(horaire);
    setIsHoraireDialogOpen(true);
  };

  const handleDeleteHoraire = async (horaireId: string) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cet horaire ?')) return;
    
    try {
      const { error } = await supabase
        .from('horaires_base_secretaires')
        .delete()
        .eq('id', horaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Horaire supprimé avec succès",
      });
      
      fetchSecretaires();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'horaire",
        variant: "destructive",
      });
    }
  };

  const handleHoraireSuccess = () => {
    fetchSecretaires();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Gestion des Secrétaires</h1>
          
          {canManage && (
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" onClick={() => setGlobalCalendarOpen(true)}>
                <CalendarDays className="h-4 w-4" />
                Voir Calendrier
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2" onClick={() => setSelectedSecretaire(null)}>
                    <Plus className="h-4 w-4" />
                    Ajouter une secrétaire
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>
                      {selectedSecretaire ? 'Modifier la secrétaire' : 'Ajouter une secrétaire'}
                    </DialogTitle>
                  </DialogHeader>
                  <SecretaireForm 
                    secretaire={selectedSecretaire} 
                    onSuccess={handleFormSuccess}
                  />
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
          <div className="relative flex-1 max-w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher une secrétaire..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              id="show-inactive"
            />
            <label htmlFor="show-inactive" className="text-sm font-medium cursor-pointer">
              Montrer secrétaires inactives
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSecretaires.map((secretaire) => (
            <ModernCard key={secretaire.id} className={`group ${secretaire.actif === false ? 'opacity-60' : ''}`}>
              <ModernCardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ModernCardTitle>
                        {secretaire.first_name && secretaire.name ? 
                          `${secretaire.first_name} ${secretaire.name}` : 
                          `Secrétaire ${secretaire.id.slice(0, 8)}`
                        }
                      </ModernCardTitle>
                      {secretaire.actif === false && (
                        <Badge variant="secondary" className="text-xs">
                          Inactif
                        </Badge>
                      )}
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedSecretaire(secretaire);
                            setIsDialogOpen(true);
                          }}
                          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    
                    <div className="space-y-3 mt-4">
                      {secretaire.email && (
                        <ContactInfo 
                          icon={<Mail />} 
                          text={secretaire.email} 
                        />
                      )}
                      
                      {secretaire.phone_number && (
                        <ContactInfo 
                          icon={<Phone />} 
                          text={secretaire.phone_number} 
                        />
                      )}
                    </div>
                  </div>
                  
                  {canManage && (
                    <div className="flex items-center space-x-3 ml-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedSecretaireForCalendar({
                            id: secretaire.id,
                            nom: `${secretaire.first_name} ${secretaire.name}`
                          });
                          setIsCalendarOpen(true);
                        }}
                        title="Calendrier mensuel"
                      >
                        <Calendar className="h-4 w-4" />
                      </Button>
                      
                      {secretaire.actif !== false ? (
                      // Switch actif - avec confirmation pour désactiver
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={true}
                              className="data-[state=checked]:bg-primary"
                            />
                          </div>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
                            <AlertDialogDescription>
                              Êtes-vous sûr de vouloir passer cette secrétaire en inactif ?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => handleToggleStatus(secretaire.id, true, true)}
                              className="bg-muted text-muted-foreground hover:bg-muted/90"
                            >
                              Passer en inactif
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      // Switch inactif - activation directe
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={false}
                          onCheckedChange={() => handleToggleStatus(secretaire.id, false, true)}
                          className="data-[state=unchecked]:bg-muted"
                        />
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </ModernCardHeader>
              
              <ModernCardContent>
                <div className="space-y-4">
                  {/* Médecin assigné */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Médecins assignés
                      </p>
                      {canManage && (
                        <QuickEditMedecinDialog
                          secretaireId={secretaire.id}
                          medecinsActuelsDetails={secretaire.medecins_assignes_details || []}
                          onSuccess={fetchSecretaires}
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {secretaire.medecins_assignes_details && secretaire.medecins_assignes_details.length > 0 ? (
                        secretaire.medecins_assignes_details.map((medecin, idx) => (
                          <Badge 
                            key={idx} 
                            variant={medecin.priorite === '1' ? 'secondary' : 'outline'} 
                            className="text-xs"
                          >
                            {medecin.first_name} {medecin.name}
                            {medecin.priorite === '2' && ' (P2)'}
                          </Badge>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">Aucun médecin assigné</p>
                      )}
                    </div>
                  </div>

                  {/* Sites assignés */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Sites assignés
                      </p>
                      {canManage && (
                        <QuickEditSitesDialog
                          secretaireId={secretaire.id}
                          sitesActuelsDetails={secretaire.sites_assignes_details || []}
                          onSuccess={fetchSecretaires}
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {secretaire.sites_assignes_details && secretaire.sites_assignes_details.length > 0 ? (
                        secretaire.sites_assignes_details.map((site, index) => (
                          <Badge 
                            key={index} 
                            variant="outline"
                            className="text-xs"
                          >
                            {site.nom}
                            {site.priorite === '1' && <span className="ml-1 text-muted-foreground">(P1)</span>}
                            {site.priorite === '2' && <span className="ml-1 text-muted-foreground">(P2)</span>}
                            {site.priorite === '3' && <span className="ml-1 text-muted-foreground">(P3)</span>}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Aucun site assigné
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  {/* Jours de travail ou horaire flexible */}
                  <div>
                    {secretaire.horaire_flexible ? (
                      // Affichage pour horaire flexible
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                          Horaire flexible
                        </p>
                        <div className="p-3 bg-primary/10 rounded-lg border-2 border-primary/30">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-2xl font-bold text-primary">
                              {secretaire.pourcentage_temps}%
                            </span>
                            <span className="text-xs text-muted-foreground">du temps</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // Affichage normal des jours de travail
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                          Jours de travail
                        </p>
                        <div className="space-y-2">
                          {[1, 2, 3, 4, 5].map((jour) => {
                            const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
                            const horairesJour = (secretaire.horaires_base_secretaires?.filter(h => h.jour_semaine === jour) || [])
                              .sort((a, b) => {
                                const ordre = { 'matin': 1, 'apres_midi': 2, 'toute_journee': 3 };
                                return (ordre[a.demi_journee] || 4) - (ordre[b.demi_journee] || 4);
                              });
                            
                            return (
                              <div key={jour} className="space-y-2">
                                {horairesJour.length === 0 && (
                                  <div className="flex items-center justify-between gap-2 p-2 bg-muted/10 rounded-md">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-xs font-medium">
                                        {jours[jour]}
                                      </Badge>
                                      <span className="text-xs text-muted-foreground">Non travaillé</span>
                                    </div>
                                    {canManage && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleAddHoraire(secretaire.id, jour)}
                                        className="h-7 w-7 p-0"
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                )}
                                
                                {horairesJour.map((horaire, index) => (
                                  <div key={`${jour}-${index}`} className="flex items-start justify-between gap-3 p-2 bg-muted/30 rounded-md group">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="text-xs font-medium">
                                          {jours[jour]}
                                        </Badge>
                                        <Badge 
                                          variant="outline" 
                                          className={`text-xs bg-transparent ${
                                            horaire.demi_journee === 'toute_journee' 
                                              ? 'border-2 border-green-600' 
                                              : horaire.demi_journee === 'apres_midi'
                                              ? 'border-2 border-yellow-600'
                                              : 'border-2 border-blue-600'
                                          }`}
                                        >
                                          {horaire.demi_journee === 'matin' ? 'Matin' : 
                                           horaire.demi_journee === 'apres_midi' ? 'Après-midi' : 
                                           'Toute la journée'}
                                        </Badge>
                                         {horaire.sites?.nom && (
                                          <span className="text-xs text-muted-foreground truncate">
                                            {horaire.sites.nom}
                                          </span>
                                        )}
                                        {horaire.alternance_type && horaire.alternance_type !== 'hebdomadaire' && (
                                          <Badge variant="secondary" className="text-xs">
                                            {horaire.alternance_type === 'une_sur_deux' ? '1/2' :
                                             horaire.alternance_type === 'une_sur_trois' ? '1/3' :
                                             horaire.alternance_type === 'une_sur_quatre' ? '1/4' : ''}
                                          </Badge>
                                        )}
                                      </div>
                                      {(horaire.date_debut || horaire.date_fin) && (
                                        <p className="text-xs text-muted-foreground">
                                          {horaire.date_debut && `Du ${new Date(horaire.date_debut).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
                                          {horaire.date_fin && ` au ${new Date(horaire.date_fin).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
                                        </p>
                                      )}
                                    </div>
                                    {canManage && (
                                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleEditHoraire(secretaire.id, horaire)}
                                          className="h-7 w-7 p-0"
                                        >
                                          <Edit className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleDeleteHoraire(horaire.id)}
                                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </ModernCardContent>
            </ModernCard>
          ))}
        </div>

        {filteredSecretaires.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm ? 'Aucune secrétaire trouvée pour cette recherche' : showInactive ? 'Aucune secrétaire inactive' : 'Aucune secrétaire enregistrée'}
            </p>
          </div>
        )}

        {/* Dialog for editing horaires */}
        <EditHoraireSecretaireDialog
          open={isHoraireDialogOpen}
          onOpenChange={setIsHoraireDialogOpen}
          secretaireId={editingSecretaireId}
          jour={selectedJour}
          horaire={selectedHoraire}
          onSuccess={handleHoraireSuccess}
        />

        {/* Calendrier mensuel */}
        {selectedSecretaireForCalendar && (
          <SecretaireMonthCalendar
            open={isCalendarOpen}
            onOpenChange={setIsCalendarOpen}
            secretaireId={selectedSecretaireForCalendar.id}
            secretaireNom={selectedSecretaireForCalendar.nom}
          />
        )}

        {/* Calendrier global */}
        <GlobalCalendarView
          open={globalCalendarOpen}
          onOpenChange={setGlobalCalendarOpen}
        />
    </div>
  );
}