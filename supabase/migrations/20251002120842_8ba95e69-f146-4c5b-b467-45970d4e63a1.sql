-- Add 'annule' to statut_planning enum if missing (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'annule' 
      AND enumtypid = 'statut_planning'::regtype
  ) THEN
    ALTER TYPE statut_planning ADD VALUE 'annule';
  END IF;
END $$;
