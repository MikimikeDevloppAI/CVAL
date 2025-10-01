import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle, ContactInfo } from '@/components/ui/modern-card';
import { MedecinForm } from '@/components/medecins/MedecinForm';
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
                jour_semaine,
                heure_debut,
                heure_fin,
                site_id,
                actif,
                sites!horaires_base_medecins_site_id_fkey (
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
                  heureDebut: horaireExistant.heure_debut || '07:30',
                  heureFin: horaireExistant.heure_fin || '17:00',
                  siteId: horaireExistant.site_id || '',
                  actif: horaireExistant.actif !== false
                });
              } else {
                horaires.push({
                  jour,
                  jourTravaille: false,
                  heureDebut: '07:30',
                  heureFin: '17:00',
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

  const filteredMedecins = medecins.filter(medecin => {
    const matchesSearch = medecin.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           medecin.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           medecin.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           medecin.specialites?.nom.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = showInactive ? medecin.actif === false : medecin.actif !== false;
    
    return matchesSearch && matchesStatus;
  });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedMedecin(null);
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
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" onClick={() => setSelectedMedecin(null)}>
                  <Plus className="h-4 w-4" />
                  Ajouter un médecin
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {selectedMedecin ? 'Modifier le médecin' : 'Ajouter un médecin'}
                </DialogTitle>
              </DialogHeader>
              <MedecinForm 
                medecin={selectedMedecin} 
                onSuccess={handleFormSuccess}
              />
            </DialogContent>
          </Dialog>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMedecins.map((medecin) => (
            <ModernCard key={medecin.id} className={medecin.actif === false ? 'opacity-60' : ''}>
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
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedMedecin(medecin);
                          setIsDialogOpen(true);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Edit className="h-4 w-4" />
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
                  {medecin.horaires_base_medecins && medecin.horaires_base_medecins.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Jours de travail
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {medecin.horaires_base_medecins.map((horaire, index) => {
                          const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
                          return (
                            <Badge key={index} variant="outline" className="text-xs">
                              {jours[horaire.jour_semaine]} - {horaire.sites?.nom}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
    </div>
  );
}