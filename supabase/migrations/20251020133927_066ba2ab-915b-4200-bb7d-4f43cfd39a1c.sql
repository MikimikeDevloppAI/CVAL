-- Ajouter les colonnes de responsabilité à capacite_effective
ALTER TABLE capacite_effective
ADD COLUMN IF NOT EXISTS is_1r BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS is_2f BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS is_3f BOOLEAN NOT NULL DEFAULT false;

-- Ajouter une contrainte d'unicité pour éviter les doublons
-- Une secrétaire ne peut avoir qu'une seule capacité par jour/période
CREATE UNIQUE INDEX IF NOT EXISTS idx_capacite_unique_secretaire_date_periode 
ON capacite_effective(secretaire_id, date, demi_journee)
WHERE actif = true AND secretaire_id IS NOT NULL;

-- Créer une fonction pour vérifier qu'une seule responsabilité est cochée
CREATE OR REPLACE FUNCTION check_single_responsibility()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.is_1r::int + NEW.is_2f::int + NEW.is_3f::int) > 1 THEN
    RAISE EXCEPTION 'Une secrétaire ne peut avoir qu''une seule responsabilité (1R, 2F ou 3F)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger pour enforcer la contrainte de responsabilité unique
DROP TRIGGER IF EXISTS enforce_single_responsibility ON capacite_effective;
CREATE TRIGGER enforce_single_responsibility
BEFORE INSERT OR UPDATE ON capacite_effective
FOR EACH ROW
EXECUTE FUNCTION check_single_responsibility();