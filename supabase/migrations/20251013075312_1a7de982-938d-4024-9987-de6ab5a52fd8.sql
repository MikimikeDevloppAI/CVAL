-- Create new enum with corrected values
CREATE TYPE type_besoin_personnel_new AS ENUM (
  'anesthesiste',
  'instrumentiste',
  'instrumentiste_aide_salle',
  'aide_salle',
  'accueil'
);

-- Update the table to use the new enum
ALTER TABLE types_intervention_besoins_personnel 
  ALTER COLUMN type_besoin TYPE type_besoin_personnel_new 
  USING (
    CASE type_besoin::text
      WHEN 'instrumentaliste' THEN 'instrumentiste'::type_besoin_personnel_new
      WHEN 'instrumentaliste_aide_salle' THEN 'instrumentiste_aide_salle'::type_besoin_personnel_new
      ELSE type_besoin::text::type_besoin_personnel_new
    END
  );

-- Drop old enum and rename new one
DROP TYPE type_besoin_personnel;
ALTER TYPE type_besoin_personnel_new RENAME TO type_besoin_personnel;