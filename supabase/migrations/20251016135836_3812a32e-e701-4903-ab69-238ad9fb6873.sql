-- Supprimer les besoins opérationnels non désirés
DELETE FROM public.besoins_operations 
WHERE code IN ('assignation_administrative', 'instrumentiste_aide_salle');

-- Ajouter les nouveaux besoins opérationnels
INSERT INTO public.besoins_operations (code, nom, categorie, actif) VALUES
('instrumentiste_dermato', 'Instrumentiste Dermatologie', 'Bloc opératoire', true),
('instrumentiste_oculoplastie', 'Instrumentiste Oculoplastie', 'Bloc opératoire', true),
('instrumentiste_ivt', 'IVT Instrumentiste', 'Bloc opératoire', true),
('instrumentiste_cataracte', 'Cataracte Instrumentiste', 'Bloc opératoire', true),
('aide_salle_cataracte', 'Aide de salle Cataracte', 'Bloc opératoire', true),
('accueil_aide_ivt', 'Accueil/Aide IVT', 'Accueil', true),
('aide_salle_oculoplastie', 'Aide de salle Oculoplastie', 'Bloc opératoire', true)
ON CONFLICT (code) DO NOTHING;