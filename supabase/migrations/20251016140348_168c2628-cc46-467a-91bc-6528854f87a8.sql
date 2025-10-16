-- Ajouter le nouveau besoin opérationnel
INSERT INTO public.besoins_operations (code, nom, categorie, actif) VALUES
('aide_salle_dermato', 'Aide de salle Dermatologie', 'Bloc opératoire', true)
ON CONFLICT (code) DO NOTHING;