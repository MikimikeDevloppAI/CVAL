-- Update configurations_multi_flux_interventions to convert text room names to UUIDs
UPDATE public.configurations_multi_flux_interventions
SET salle = CASE 
  WHEN salle::text = 'jaune' THEN '8965e942-0c6b-4261-a976-2bdf6cd13a00'::uuid
  WHEN salle::text = 'rouge' THEN 'ae6dc538-e24c-4f53-b6f5-689a97ac4292'::uuid
  WHEN salle::text = 'vert' OR salle::text = 'verte' THEN 'b8279252-aa3a-436d-b184-54da0de62f49'::uuid
  ELSE salle
END
WHERE salle IS NOT NULL;

-- Create function to trigger reassignment of all rooms
CREATE OR REPLACE FUNCTION public.trigger_reassign_all_rooms()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slot RECORD;
BEGIN
  FOR v_slot IN
    SELECT DISTINCT date, periode
    FROM public.planning_genere_bloc_operatoire
    WHERE statut != 'annule'::statut_planning
    ORDER BY date, periode
  LOOP
    PERFORM public.reassign_all_rooms_for_slot(v_slot.date, v_slot.periode);
  END LOOP;
END;
$function$;

-- Trigger reassignment for all existing slots
SELECT public.trigger_reassign_all_rooms();