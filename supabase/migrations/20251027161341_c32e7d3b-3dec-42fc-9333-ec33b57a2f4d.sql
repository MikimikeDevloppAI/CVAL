-- Sauvegarde et remplacement temporaire de la fonction de refresh

-- 1) Remplacer temporairement la fonction refresh par une version vide
CREATE OR REPLACE FUNCTION public.refresh_all_besoins_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Version temporaire vide pour éviter les locks pendant la régénération massive
  RETURN;
END;
$$;

-- 2) Désactiver les triggers utilisateur pour la suppression
SET session_replication_role = 'replica';

-- 3) Vider capacite_effective_dry_run
DELETE FROM public.capacite_effective_dry_run
WHERE EXTRACT(ISODOW FROM date) != 6;

-- 4) Nettoyer planning_genere_bloc_operatoire
UPDATE public.planning_genere_bloc_operatoire
SET besoin_effectif_id = NULL
WHERE EXTRACT(ISODOW FROM date) != 6;

-- 5) Nettoyer capacite_effective
UPDATE public.capacite_effective
SET 
  planning_genere_bloc_operatoire_id = NULL,
  besoin_operation_id = NULL
WHERE EXTRACT(ISODOW FROM date) != 6;

-- 6) Supprimer capacités (sauf samedi)
DELETE FROM public.capacite_effective
WHERE EXTRACT(ISODOW FROM date) != 6;

-- 7) Supprimer besoins (sauf samedi)
DELETE FROM public.besoin_effectif
WHERE EXTRACT(ISODOW FROM date) != 6;

-- Réactiver les triggers
SET session_replication_role = 'origin';

-- 8) Régénérer capacités
DO $$
DECLARE
  v_horaire RECORD;
BEGIN
  FOR v_horaire IN
    SELECT * FROM public.horaires_base_secretaires
    WHERE actif = true AND jour_semaine != 6
    ORDER BY id
  LOOP
    PERFORM public.handle_horaire_secretaire_insert_logic(v_horaire);
  END LOOP;
END $$;

-- 9) Régénérer besoins
DO $$
DECLARE
  v_horaire RECORD;
BEGIN
  FOR v_horaire IN
    SELECT * FROM public.horaires_base_medecins
    WHERE actif = true AND jour_semaine != 6
    ORDER BY id
  LOOP
    PERFORM public.handle_horaire_medecin_insert_logic(v_horaire);
  END LOOP;
END $$;

-- 10) Restaurer la vraie fonction de refresh
CREATE OR REPLACE FUNCTION public.refresh_all_besoins_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_sites_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_bloc_operatoire_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_fermeture_summary;
END;
$$;

-- 11) Faire le refresh final
REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_sites_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_bloc_operatoire_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_fermeture_summary;
