import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Mail, Phone, Trash2, CalendarDays, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle, ContactInfo } from '@/components/ui/modern-card';
import { MedecinForm } from '@/components/medecins/MedecinForm';
import { EditHoraireDialog } from '@/components/medecins/EditHoraireDialog';
import { MedecinMonthCalendar } from '@/components/medecins/MedecinMonthCalendar';
import { GlobalMedecinCalendarView } from '@/components/medecins/GlobalMedecinCalendarView';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface Medecin {
  id: string;
  first_name: string;
  name: string;
  email: string;
  phone_number: string;
  actif?: boolean;
  specialites: {
    nom: string;
    code: string;
  };
  horaires?: any[];
  horaires_base_medecins?: any[];
}

export default function MedecinsPage() {
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedMedecin, setSelectedMedecin] = useState<Medecin | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isHoraireDialogOpen, setIsHoraireDialogOpen] = useState(false);
  const [selectedJour, setSelectedJour] = useState<number>(1);
  const [selectedHoraire, setSelectedHoraire] = useState<any>(null);
  const [editingMedecinId, setEditingMedecinId] = useState<string>('');
  const [calendarMedecin, setCalendarMedecin] = useState<{ id: string; nom: string } | null>(null);
  const [globalCalendarOpen, setGlobalCalendarOpen] = useState(false);
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const fetchMedecins = async () => {
    try {
      // D'abord récupérer les médecins avec leurs spécialités
      const { data: medecinsData, error: medecinsError } = await supabase
        .from('medecins')
        .select(`
          id,
          first_name,
          name,
          email,
          phone_number,
          actif,
          specialite_id,
          specialites!medecins_specialite_id_fkey (
            nom,
            code
          )
        `);

      if (medecinsError) throw medecinsError;

      // Ensuite enrichir avec les horaires pour chaque médecin
      if (medecinsData && medecinsData.length > 0) {
        const medecinsWithHoraires = await Promise.all(
          medecinsData.map(async (medecin: any) => {
            // Récupérer les horaires
      const { data: horairesData } = await supabase
        .from('horaires_base_medecins')
        .select(`
          id,
          jour_semaine,
          demi_journee,
          site_id,
          actif,
          alternance_type,
          alternance_semaine_modulo,
          date_debut,
          date_fin,
          type_intervention_id,
          sites!horaires_base_medecins_site_id_fkey (
            nom
          ),
          types_intervention (
            nom
          )
        `)
        .eq('medecin_id', medecin.id);

            // Mapper les horaires pour le formulaire
            const horaires = [];
            for (let jour = 1; jour <= 5; jour++) {
              const horaireExistant = horairesData?.find(h => h.jour_semaine === jour);
              
              if (horaireExistant) {
                horaires.push({
                  jour,
                  jourTravaille: true,
                  demiJournee: horaireExistant.demi_journee || 'toute_journee',
                  siteId: horaireExistant.site_id || '',
                  actif: horaireExistant.actif !== false
                });
              } else {
                horaires.push({
                  jour,
                  jourTravaille: false,
                  demiJournee: 'toute_journee',
                  siteId: '',
                  actif: true
                });
              }
            }

            return {
              ...medecin,
              horaires,
              horaires_base_medecins: horairesData || []
            };
          })
        );
        setMedecins(medecinsWithHoraires as Medecin[]);
      } else {
        setMedecins([]);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des médecins:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les médecins",
        variant: "destructive",
      });
      setMedecins([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedecins();
  }, []);

  const handleToggleStatus = async (medecinId: string, currentStatus: boolean, skipConfirmation: boolean = false) => {
    // Si on désactive et qu'on n'a pas skip la confirmation, on ne fait rien ici
    // La confirmation sera gérée par l'AlertDialog
    if (currentStatus && !skipConfirmation) {
      return;
    }

    try {
      const { error } = await supabase
        .from('medecins')
        .update({ actif: !currentStatus })
        .eq('id', medecinId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: `Médecin ${!currentStatus ? 'activé' : 'désactivé'} avec succès`,
      });
      
      fetchMedecins();
    } catch (error) {
      console.error('Erreur lors de la modification du statut:', error);
      toast({
        title: "Erreur",
        description: "Impossible de modifier le statut du médecin",
        variant: "destructive",
      });
    }
  };

  const filteredMedecins = medecins
    .filter(medecin => {
      const matchesSearch = medecin.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
             medecin.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
             medecin.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
             medecin.specialites?.nom.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = showInactive ? medecin.actif === false : medecin.actif !== false;
      
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const prenomA = (a.first_name || '').toLowerCase();
      const prenomB = (b.first_name || '').toLowerCase();
      return prenomA.localeCompare(prenomB);
    });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedMedecin(null);
    fetchMedecins();
  };

  const handleAddHoraire = (medecinId: string, jour: number) => {
    setEditingMedecinId(medecinId);
    setSelectedJour(jour);
    setSelectedHoraire(null);
    setIsHoraireDialogOpen(true);
  };

  const handleEditHoraire = (medecinId: string, horaire: any) => {
    setEditingMedecinId(medecinId);
    setSelectedJour(horaire.jour_semaine);
    setSelectedHoraire(horaire);
    setIsHoraireDialogOpen(true);
  };

  const handleDeleteHoraire = async (horaireId: string) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cet horaire ?')) return;
    
    try {
      const { error } = await supabase
        .from('horaires_base_medecins')
        .delete()
        .eq('id', horaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Horaire supprimé avec succès",
      });
      
      fetchMedecins();
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
    fetchMedecins();
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
          <h1 className="text-2xl font-bold text-foreground">Gestion des Médecins</h1>
          
          {canManage && (
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                className="gap-2" 
                onClick={() => setGlobalCalendarOpen(true)}
              >
                <Calendar className="h-4 w-4" />
                Calendrier global
              </Button>
              
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2" onClick={() => setSelectedMedecin(null)}>
                    <Plus className="h-4 w-4" />
                    Ajouter un médecin
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl w-full max-h-[90vh] flex flex-col p-0">
                  <DialogHeader className="px-6 pt-6">
                    <DialogTitle>
                      {selectedMedecin ? 'Modifier le médecin' : 'Ajouter un médecin'}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="overflow-y-auto px-6 flex-1">
                    <MedecinForm 
                      medecin={selectedMedecin} 
                      onSuccess={handleFormSuccess}
                    />
                  </div>
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
              placeholder="Rechercher un médecin..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              id="show-inactive-medecins"
            />
            <label htmlFor="show-inactive-medecins" className="text-sm font-medium cursor-pointer">
              Montrer médecins inactifs
            </label>
          </div>
        </div>

        {/* Médecins Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredMedecins.map((medecin) => (
            <ModernCard key={medecin.id} className={`group ${medecin.actif === false ? 'opacity-60' : ''}`}>
              <ModernCardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ModernCardTitle>
                        {medecin.first_name} {medecin.name}
                      </ModernCardTitle>
                      {medecin.actif === false && (
                        <Badge variant="secondary" className="text-xs">
                          Inactif
                        </Badge>
                      )}
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedMedecin(medecin);
                            setIsDialogOpen(true);
                          }}
                          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    
                    <div className="space-y-3 mt-4">
                      {medecin.email && (
                        <ContactInfo 
                          icon={<Mail />} 
                          text={medecin.email} 
                        />
                      )}
                      
                      {medecin.phone_number && (
                        <ContactInfo 
                          icon={<Phone />} 
                          text={medecin.phone_number} 
                        />
                      )}
                    </div>
                  </div>
                  
                  {canManage && (
                    <div className="flex items-center space-x-3 ml-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCalendarMedecin({ id: medecin.id, nom: `${medecin.first_name} ${medecin.name}` })}
                      >
                        <CalendarDays className="h-4 w-4" />
                      </Button>
                      
                      {medecin.actif !== false ? (
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
                              Êtes-vous sûr de vouloir passer ce médecin en inactif ?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => handleToggleStatus(medecin.id, true, true)}
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
                          onCheckedChange={() => handleToggleStatus(medecin.id, false, true)}
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
                  {/* Spécialité */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Spécialité
                    </p>
                    <Badge variant="secondary" className="text-xs">
                      {medecin.specialites?.nom}
                    </Badge>
                  </div>

                  {/* Jours de travail */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                      Jours de travail
                    </p>
                    <div className="space-y-2">
                      {[1, 2, 3, 4, 5].map((jour) => {
                        const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
                        const horairesJour = (medecin.horaires_base_medecins?.filter(h => h.jour_semaine === jour) || [])
                          .sort((a, b) => {
                            // Ordre: matin, apres_midi, toute_journee
                            const ordre = { 'matin': 1, 'apres_midi': 2, 'toute_journee': 3 };
                            return (ordre[a.demi_journee] || 4) - (ordre[b.demi_journee] || 4);
                          });
                        const alternanceLabels = {
                          'hebdomadaire': 'Hebdo',
                          'une_sur_deux': '1/2',
                          'une_sur_trois': '1/3',
                          'une_sur_quatre': '1/4'
                        };
                        
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
                                    onClick={() => handleAddHoraire(medecin.id, jour)}
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
                                     <span className="text-xs text-muted-foreground truncate">
                                       {horaire.sites?.nom}
                                       {horaire.types_intervention && (
                                         <> ({horaire.types_intervention.nom})</>
                                       )}
                                     </span>
                                   </div>
                                  {(horaire.date_debut || horaire.date_fin) && (
                                    <p className="text-xs text-muted-foreground">
                                      {horaire.date_debut && `Du ${new Date(horaire.date_debut).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
                                      {horaire.date_fin && ` au ${new Date(horaire.date_fin).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
                                      {!horaire.date_debut && !horaire.date_fin && 'Permanent'}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                {horaire.alternance_type && horaire.alternance_type !== 'hebdomadaire' && (
                                    <Badge variant="secondary" className="text-xs shrink-0">
                                      {alternanceLabels[horaire.alternance_type]}
                                      {horaire.alternance_type === 'une_sur_deux' && (
                                        <> - {horaire.alternance_semaine_modulo === 0 ? 'Paire' : 'Impaire'}</>
                                      )}
                                      {horaire.alternance_type === 'une_sur_trois' && (
                                        <> - Sem. {horaire.alternance_semaine_modulo + 1}</>
                                      )}
                                      {horaire.alternance_type === 'une_sur_quatre' && (
                                        <> - Sem. {horaire.alternance_semaine_modulo + 1}</>
                                      )}
                                    </Badge>
                                  )}
                                  {canManage && (
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleEditHoraire(medecin.id, horaire)}
                                        className="h-7 w-7 p-0"
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteHoraire(horaire.id)}
                                        className="h-7 w-7 p-0 text-destructive"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                            
                            {horairesJour.length > 0 && canManage && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleAddHoraire(medecin.id, jour)}
                                className="w-full h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Ajouter un créneau
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </ModernCardContent>
            </ModernCard>
          ))}
        </div>

        {filteredMedecins.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm ? 'Aucun médecin trouvé pour cette recherche' : showInactive ? 'Aucun médecin inactif' : 'Aucun médecin enregistré'}
            </p>
          </div>
        )}

        <EditHoraireDialog
          open={isHoraireDialogOpen}
          onOpenChange={setIsHoraireDialogOpen}
          medecinId={editingMedecinId}
          jour={selectedJour}
          horaire={selectedHoraire}
          onSuccess={handleHoraireSuccess}
        />

        <MedecinMonthCalendar
          open={!!calendarMedecin}
          onOpenChange={(open) => !open && setCalendarMedecin(null)}
          medecinId={calendarMedecin?.id || ''}
          medecinNom={calendarMedecin?.nom || ''}
        />

        <GlobalMedecinCalendarView
          open={globalCalendarOpen}
          onOpenChange={setGlobalCalendarOpen}
        />
    </div>
  );
}