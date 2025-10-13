-- Ajouter colonnes responsables à planning_genere_site_besoin
ALTER TABLE planning_genere_site_besoin
  ADD COLUMN IF NOT EXISTS responsable_1r_id UUID REFERENCES secretaires(id),
  ADD COLUMN IF NOT EXISTS responsable_2f_id UUID REFERENCES secretaires(id),
  ADD COLUMN IF NOT EXISTS responsable_3f_id UUID REFERENCES secretaires(id),
  ADD COLUMN IF NOT EXISTS heure_debut TIME,
  ADD COLUMN IF NOT EXISTS heure_fin TIME;