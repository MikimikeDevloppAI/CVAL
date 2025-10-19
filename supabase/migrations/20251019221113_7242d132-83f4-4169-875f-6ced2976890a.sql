-- Add 'trois_sur_quatre' value to type_alternance enum
ALTER TYPE type_alternance ADD VALUE IF NOT EXISTS 'trois_sur_quatre';

-- Update the should_doctor_work function to handle 3/4 alternance
CREATE OR REPLACE FUNCTION public.should_doctor_work(
  p_alternance_type type_alternance, 
  p_alternance_modulo integer, 
  p_target_date date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_week_number integer;
BEGIN
  v_week_number := EXTRACT(WEEK FROM p_target_date)::integer;
  
  RETURN CASE p_alternance_type
    WHEN 'hebdomadaire' THEN true
    WHEN 'une_sur_deux' THEN (v_week_number % 2 = p_alternance_modulo)
    WHEN 'une_sur_trois' THEN (v_week_number % 3 = p_alternance_modulo)
    WHEN 'une_sur_quatre' THEN (v_week_number % 4 = p_alternance_modulo)
    WHEN 'trois_sur_quatre' THEN (v_week_number % 4 != p_alternance_modulo)
    ELSE true
  END;
END;
$function$;