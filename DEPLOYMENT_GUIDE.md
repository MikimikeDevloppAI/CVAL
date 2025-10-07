# Guide de Déploiement TEST / PROD

## Architecture
Ce projet utilise **deux projets Supabase séparés** :
- **TEST** : `xvuugxjseavbxpxhfprb` (développement local)
- **PROD** : `lzzmbidhehieytprlzbz` (production)

---

## 🔧 Commandes

### Développement (TEST)
```bash
npm run dev
```
Utilise automatiquement `.env.development` avec les clés TEST.

### Build Production
```bash
npm run build
```
Utilise automatiquement `.env.production` avec les clés PROD.

### Preview Production (local)
```bash
npm run preview
```
Lance une preview locale du build de production.

---

## 📁 Configuration des Environnements

### `.env.development` (TEST)
```env
VITE_SUPABASE_URL=https://xvuugxjseavbxpxhfprb.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_SUPABASE_PROJECT_ID=xvuugxjseavbxpxhfprb
```

### `.env.production` (PROD)
```env
VITE_SUPABASE_URL=https://lzzmbidhehieytprlzbz.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_SUPABASE_PROJECT_ID=lzzmbidhehieytprlzbz
```

---

## 🗄️ Gestion de la Base de Données

### Migrations Manuelles
Les migrations SQL sont gérées **manuellement** dans les deux environnements :

1. **Développer en TEST** : testez vos changements sur le projet TEST
2. **Exporter la migration** : créez un fichier SQL avec vos changements
3. **Appliquer en PROD** : exécutez manuellement le SQL dans le SQL Editor de PROD

### SQL Editor Supabase
- **TEST** : https://supabase.com/dashboard/project/xvuugxjseavbxpxhfprb/sql
- **PROD** : https://supabase.com/dashboard/project/lzzmbidhehieytprlzbz/sql

---

## 🚀 Edge Functions

### Déploiement TEST
```bash
npx supabase functions deploy --project-ref xvuugxjseavbxpxhfprb
```

### Déploiement PROD
```bash
npx supabase functions deploy --project-ref lzzmbidhehieytprlzbz
```

### Secrets Management
Les secrets (service_role_key, etc.) doivent être configurés séparément dans chaque projet :
- **TEST** : https://supabase.com/dashboard/project/xvuugxjseavbxpxhfprb/settings/functions
- **PROD** : https://supabase.com/dashboard/project/lzzmbidhehieytprlzbz/settings/functions

---

## ⚠️ Checklist de Déploiement PROD

Avant chaque déploiement en production :

- [ ] **Tester en TEST** : toutes les fonctionnalités fonctionnent
- [ ] **Migrations SQL** : appliquées manuellement en PROD
- [ ] **Edge Functions** : déployées avec `--project-ref lzzmbidhehieytprlzbz`
- [ ] **Secrets** : vérifiés dans les settings PROD
- [ ] **Build** : `npm run build` sans erreurs
- [ ] **Preview locale** : `npm run preview` pour tester le build
- [ ] **Déploiement frontend** : via votre plateforme (Vercel, Netlify, etc.)

---

## 📊 Surveillance

### Logs Edge Functions
- **TEST** : https://supabase.com/dashboard/project/xvuugxjseavbxpxhfprb/functions
- **PROD** : https://supabase.com/dashboard/project/lzzmbidhehieytprlzbz/functions

### Monitoring Base de Données
- **TEST** : https://supabase.com/dashboard/project/xvuugxjseavbxpxhfprb/database/tables
- **PROD** : https://supabase.com/dashboard/project/lzzmbidhehieytprlzbz/database/tables

---

## 🔐 Sécurité

**IMPORTANT** : Les fichiers `.env.*` contiennent uniquement les clés **publiques** (anon key).
Les clés **service_role** ne doivent JAMAIS être commitées dans le code.
Elles sont configurées directement dans les Edge Functions via Supabase Dashboard.
