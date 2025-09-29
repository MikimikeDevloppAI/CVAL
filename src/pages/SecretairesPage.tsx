import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle, ContactInfo } from '@/components/ui/modern-card';
import { SecretaireForm } from '@/components/secretaires/SecretaireForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Secretaire {
  id: string;
  first_name?: string;
  name?: string;
  email?: string;
  phone_number?: string;
  specialites: string[];
  specialites_details?: { nom: string }[];
  horaires_base_secretaires?: { jour_semaine: number; heure_debut?: string; heure_fin?: string; actif?: boolean }[];
  horaires?: { jour: number; jourTravaille: boolean; heureDebut: string; heureFin: string; actif: boolean }[];
  profile_id?: string;
  site_preferentiel_id?: string;
  prefere_port_en_truie?: boolean;
  flexible_jours_supplementaires?: boolean;
  nombre_jours_supplementaires?: number;
  actif?: boolean;
  sites?: {
    nom: string;
  } | null;
}

import { Layout } from '@/components/layout/Layout';

export default function SecretairesPage() {
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSecretaire, setSelectedSecretaire] = useState<Secretaire | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

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
          specialites,
          site_preferentiel_id,
          prefere_port_en_truie,
          flexible_jours_supplementaires,
          nombre_jours_supplementaires,
          actif,
          sites (
            nom
          ),
          horaires_base_secretaires (
            jour_semaine,
            heure_debut,
            heure_fin,
            actif
          )
        `);

      if (secretairesError) {
        console.error('Erreur de requête secrétaires:', secretairesError);
        throw secretairesError;
      }

      // Ensuite enrichir avec les noms des spécialités et mapper les horaires
      if (secretairesData && secretairesData.length > 0) {
        const secretairesWithSpecialites = await Promise.all(
          secretairesData.map(async (secretaire: any) => {
            let specialites_details = [];
            
            // Récupérer les noms des spécialités
            if (secretaire.specialites && secretaire.specialites.length > 0) {
              const { data: specialitesData } = await supabase
                .from('specialites')
                .select('nom')
                .in('id', secretaire.specialites);
              
              specialites_details = specialitesData || [];
            }

            // Mapper les horaires pour le formulaire
            const horaires = [];
            for (let jour = 1; jour <= 5; jour++) {
              const horaireExistant = secretaire.horaires_base_secretaires?.find(
                (h: any) => h.jour_semaine === jour
              );
              
              if (horaireExistant) {
                horaires.push({
                  jour,
                  jourTravaille: true,
                  heureDebut: horaireExistant.heure_debut || '07:30',
                  heureFin: horaireExistant.heure_fin || '17:00',
                  actif: horaireExistant.actif !== false
                });
              } else {
                horaires.push({
                  jour,
                  jourTravaille: false,
                  heureDebut: '07:30',
                  heureFin: '17:00',
                  actif: true
                });
              }
            }
            
            return {
              ...secretaire,
              specialites_details,
              horaires
            };
          })
        );
        setSecretaires(secretairesWithSpecialites as Secretaire[]);
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

  const toggleSecretaireStatus = async (secretaireId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('secretaires')
        .update({ actif: !currentStatus })
        .eq('id', secretaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: `Secrétaire ${!currentStatus ? 'activé' : 'désactivé'} avec succès`,
      });
      
      fetchSecretaires();
    } catch (error) {
      console.error('Erreur lors de la modification du statut:', error);
      toast({
        title: "Erreur",
        description: "Impossible de modifier le statut du secrétaire",
        variant: "destructive",
      });
    }
  };

  const filteredSecretaires = secretaires.filter(secretaire => {
    const prenom = secretaire.first_name || '';
    const nom = secretaire.name || '';
    const email = secretaire.email || '';
    const telephone = secretaire.phone_number || '';
    
    return prenom.toLowerCase().includes(searchTerm.toLowerCase()) ||
           nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
           email.toLowerCase().includes(searchTerm.toLowerCase()) ||
           telephone.toLowerCase().includes(searchTerm.toLowerCase()) ||
           secretaire.id.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedSecretaire(null);
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
    <Layout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Gestion des Secrétaires</h1>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => setSelectedSecretaire(null)}>
                <Plus className="h-4 w-4" />
                Ajouter un secrétaire
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {selectedSecretaire ? 'Modifier le secrétaire' : 'Ajouter un secrétaire'}
                </DialogTitle>
              </DialogHeader>
              <SecretaireForm 
                secretaire={selectedSecretaire} 
                onSuccess={handleFormSuccess}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="flex items-center space-x-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un secrétaire..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSecretaires.map((secretaire) => (
            <ModernCard key={secretaire.id} className={secretaire.actif === false ? 'opacity-60' : ''}>
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
                  
                  <div className="flex space-x-2 ml-3">
                    <Button
                      variant={secretaire.actif === false ? "outline" : "default"}
                      size="sm"
                      onClick={() => toggleSecretaireStatus(secretaire.id, secretaire.actif !== false)}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs ${
                        secretaire.actif === false 
                          ? 'border-muted-foreground text-muted-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary' 
                          : 'bg-primary text-primary-foreground hover:bg-primary/90'
                      }`}
                    >
                      {secretaire.actif === false ? 'Inactif' : 'Actif'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedSecretaire(secretaire);
                        setIsDialogOpen(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </ModernCardHeader>
              
              <ModernCardContent>
                <div className="space-y-4">
                  {/* Spécialités */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Spécialités
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {secretaire.specialites_details && secretaire.specialites_details.length > 0 ? (
                        secretaire.specialites_details.map((spec, index) => (
                          <Badge key={index} variant="secondary" className="text-xs">
                            {spec.nom}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Aucune spécialité
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  {/* Jours de travail */}
                  {secretaire.horaires_base_secretaires && secretaire.horaires_base_secretaires.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Jours de travail
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {secretaire.horaires_base_secretaires.map((horaire, index) => {
                          const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
                          return (
                            <Badge key={index} variant="outline" className="text-xs">
                              {jours[horaire.jour_semaine]}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Site préférentiel */}
                  {secretaire.sites && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Site préférentiel
                      </p>
                      <p className="text-sm text-foreground">
                        {secretaire.sites.nom}
                      </p>
                    </div>
                  )}
                </div>
              </ModernCardContent>
            </ModernCard>
          ))}
        </div>

        {filteredSecretaires.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm ? 'Aucun secrétaire trouvé pour cette recherche' : 'Aucun secrétaire enregistré'}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}