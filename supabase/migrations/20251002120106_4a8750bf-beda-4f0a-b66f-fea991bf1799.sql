-- Supprimer d'abord tous les triggers sur planning_genere liés aux assignations 1R/2F
DROP TRIGGER IF EXISTS sync_assignations_1r_2f_trigger ON planning_genere;
DROP TRIGGER IF EXISTS trigger_sync_assignations_1r_2f_new ON planning_genere;

-- Maintenant supprimer les fonctions avec CASCADE pour gérer les dépendances
DROP FUNCTION IF EXISTS sync_assignations_1r_2f_new() CASCADE;
DROP FUNCTION IF EXISTS sync_assignations_1r_2f_historique() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_assignations_1r_2f() CASCADE;

-- Enfin, supprimer la table
DROP TABLE IF EXISTS assignations_1r_2f_historique CASCADE;