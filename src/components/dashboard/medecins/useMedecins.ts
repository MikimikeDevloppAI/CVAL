import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Medecin {
  id: string;
  first_name: string;
  name: string;
  email: string;
  phone_number: string;
  actif?: boolean;
  specialite_id: string;
  besoin_secretaires: number;
  specialites: {
    nom: string;
    code: string;
  };
  horaires?: any[];
  horaires_base_medecins?: any[];
}

export function useMedecins() {
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchMedecins = async () => {
    try {
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
          besoin_secretaires,
          specialites!medecins_specialite_id_fkey (
            nom,
            code
          )
        `);

      if (medecinsError) throw medecinsError;

      if (medecinsData && medecinsData.length > 0) {
        const medecinsWithHoraires = await Promise.all(
          medecinsData.map(async (medecin: any) => {
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

  const toggleStatus = async (medecinId: string, currentStatus: boolean) => {
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

  useEffect(() => {
    fetchMedecins();
  }, []);

  return { medecins, loading, fetchMedecins, toggleStatus };
}
