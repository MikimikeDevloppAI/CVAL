-- Ajouter les nouveaux types d'accueil spécialisés à l'enum type_besoin_personnel
ALTER TYPE type_besoin_personnel ADD VALUE IF NOT EXISTS 'accueil_ophtalmo';
ALTER TYPE type_besoin_personnel ADD VALUE IF NOT EXISTS 'accueil_dermato';

-- Note : On garde 'accueil' pour compatibilité, mais les nouveaux types sont recommandés