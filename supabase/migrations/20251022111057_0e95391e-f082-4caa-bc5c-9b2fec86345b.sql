-- Créer la table planning_pdfs pour stocker l'historique des PDFs générés
CREATE TABLE IF NOT EXISTS planning_pdfs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  pdf_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  nombre_secretaires INTEGER,
  nombre_semaines INTEGER
);

-- Créer des index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_planning_pdfs_dates ON planning_pdfs(date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_planning_pdfs_created_at ON planning_pdfs(created_at DESC);

-- Activer Row Level Security
ALTER TABLE planning_pdfs ENABLE ROW LEVEL SECURITY;

-- Politique permettant à tous les utilisateurs authentifiés de voir les PDFs
CREATE POLICY "Tous les utilisateurs authentifiés peuvent voir les PDFs"
  ON planning_pdfs FOR SELECT
  TO authenticated
  USING (true);

-- Politique permettant à tous les utilisateurs authentifiés de créer des PDFs
CREATE POLICY "Tous les utilisateurs authentifiés peuvent créer des PDFs"
  ON planning_pdfs FOR INSERT
  TO authenticated
  WITH CHECK (true);