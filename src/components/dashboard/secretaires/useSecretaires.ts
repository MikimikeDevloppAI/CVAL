import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Secretaire {
  id: string;
  first_name?: string;
  name?: string;
  email?: string;
  phone_number?: string;
  prefered_admin?: boolean;
  nombre_demi_journees_admin?: number;
  sites_assignes_details?: { id: string; site_id: string; nom: string; priorite?: string }[];
  medecins_assignes_details?: { id: string; medecin_id: string; first_name: string; name: string; priorite?: string }[];
  horaires_base_secretaires?: { 
    id: string;
    jour_semaine: number; 
    demi_journee?: string; 
    actif?: boolean;
    site_id?: string;
    date_debut?: string;
    date_fin?: string;
    alternance_type?: 'hebdomadaire' | 'une_sur_deux' | 'une_sur_trois' | 'une_sur_quatre' | 'trois_sur_quatre';
    alternance_semaine_modulo?: number;
    sites?: { nom: string } | null;
  }[];
  horaires?: { jour: number; jourTravaille: boolean; demiJournee: string; actif: boolean }[];
  profile_id?: string;
  flexible_jours_supplementaires?: boolean;
  nombre_jours_supplementaires?: number;
  horaire_flexible?: boolean;
  pourcentage_temps?: number;
  actif?: boolean;
  besoins_operations?: Array<{
    id: string;
    besoin_operation_id: string;
    besoins_operations: {
      nom: string;
      code: string;
      categorie?: string;
    };
    preference: number | null;
  }>;
}

export function useSecretaires() {
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchSecretaires = async () => {
    try {
      setLoading(true);
      const { data: secretairesData, error: secretairesError } = await supabase
        .from('secretaires')
        .select(`
          id,
          first_name,
          name,
          email,
          phone_number,
          prefered_admin,
          nombre_demi_journees_admin,
          profile_id,
          flexible_jours_supplementaires,
          nombre_jours_supplementaires,
          horaire_flexible,
          pourcentage_temps,
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
          ),
          besoins_operations:secretaires_besoins_operations(
            id,
            besoin_operation_id,
            preference,
            besoins_operations(nom, code, categorie)
          )
        `);

      if (secretairesError) throw secretairesError;

      if (secretairesData && secretairesData.length > 0) {
        const secretairesWithSites = await Promise.all(
          secretairesData.map(async (secretaire: any) => {
            let sites_assignes_details = [];
            
            const { data: secretairesSitesData } = await supabase
              .from('secretaires_sites')
              .select('id, site_id, priorite, sites(nom)')
              .eq('secretaire_id', secretaire.id);
            
            if (secretairesSitesData && secretairesSitesData.length > 0) {
              sites_assignes_details = secretairesSitesData.map((ss: any) => ({
                id: ss.id,
                site_id: ss.site_id,
                nom: ss.sites?.nom || '',
                priorite: ss.priorite
              }));
            }

            let medecins_assignes_details = [];
            const { data: secretairesMedecinsData } = await supabase
              .from('secretaires_medecins')
              .select('id, medecin_id, priorite')
              .eq('secretaire_id', secretaire.id);
            
            if (secretairesMedecinsData && secretairesMedecinsData.length > 0) {
              const medecinIds = secretairesMedecinsData.map((sm: any) => sm.medecin_id).filter(Boolean);
              let medecinsMap: Record<string, { first_name: string; name: string }> = {};

              if (medecinIds.length > 0) {
                const { data: medecinsData } = await supabase
                  .from('medecins')
                  .select('id, first_name, name')
                  .in('id', medecinIds);

                if (medecinsData) {
                  medecinsMap = Object.fromEntries(
                    medecinsData.map((m: any) => [m.id, { first_name: m.first_name || '', name: m.name || '' }])
                  );
                }
              }

              medecins_assignes_details = secretairesMedecinsData.map((sm: any) => ({
                id: sm.id,
                medecin_id: sm.medecin_id,
                first_name: medecinsMap[sm.medecin_id]?.first_name || '',
                name: medecinsMap[sm.medecin_id]?.name || '',
                priorite: sm.priorite
              }));
            }

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

  const toggleStatus = async (secretaireId: string, currentStatus: boolean) => {
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

  return {
    secretaires,
    loading,
    fetchSecretaires,
    toggleStatus
  };
}
