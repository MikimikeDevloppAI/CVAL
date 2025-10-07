# Guide de Branching Supabase

## État actuel
✅ Edge functions utilisent déjà `Deno.env.get('SUPABASE_URL')` et les variables d'environnement
✅ Fichier `seed.sql` créé avec les données de base
⚠️ Les migrations ne peuvent pas être créées (fichiers en lecture seule)

## Prochaines étapes

### 1. Créer les migrations manuellement
Les migrations doivent être créées dans le dashboard Supabase ou via CLI:
- Exporter le schéma actuel: `supabase db dump`
- Créer les fichiers de migration dans `supabase/migrations/`

### 2. Configuration Supabase Dashboard
1. Upgrader vers **Supabase Pro Plan** ($25/mois)
2. Installer la **Supabase GitHub App**
3. Dans Project Settings > Branching:
   - Activer le branching
   - Sélectionner `main` comme branche production
   - Activer auto-merge des migrations
   - Activer preview branches pour PRs

### 3. Workflow Git
```bash
# Développement
git checkout -b feature/nouvelle-fonctionnalite
# Faire vos modifications
git commit -am "Add feature"
git push origin feature/nouvelle-fonctionnalite
# Créer une PR → Supabase crée automatiquement une preview branch

# Test sur preview branch
# Les edge functions utilisent automatiquement l'URL de la preview branch

# Merge vers main
git merge → Supabase applique automatiquement les migrations en PROD
```

### 4. Variables d'environnement
Les edge functions utilisent déjà:
- `SUPABASE_URL` - Auto-configuré par branch
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-configuré par branch
- `SUPABASE_ANON_KEY` - Auto-configuré par branch
- `CONVERTAPI_SECRET` - À configurer manuellement

### 5. Coûts
- Pro Plan: $25/mois
- Preview branches: ~$0.32/jour par branche active (~$10/mois pour 1 branche)
- Total estimé: ~$35/mois

## Documentation
https://supabase.com/docs/guides/deployment/branching
