-- Créer les types énumérés
CREATE TYPE public.user_role AS ENUM ('admin', 'medecin', 'secretaire');
CREATE TYPE public.type_horaire AS ENUM ('fixe', 'disponible');
CREATE TYPE public.type_absence AS ENUM ('conges', 'maladie', 'formation', 'autre');
CREATE TYPE public.statut_absence AS ENUM ('en_attente', 'approuve', 'refuse');
CREATE TYPE public.priorite_besoin AS ENUM ('haute', 'moyenne', 'basse');
CREATE TYPE public.type_planning AS ENUM ('medecin', 'secretaire');
CREATE TYPE public.statut_planning AS ENUM ('planifie', 'confirme', 'absent');

-- Fonction pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Table des profils utilisateurs (étend auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.user_role NOT NULL,
    prenom TEXT NOT NULL,
    nom TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des sites
CREATE TABLE public.sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    adresse TEXT NOT NULL,
    capacite_max_medecins INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des spécialités
CREATE TABLE public.specialites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des médecins
CREATE TABLE public.medecins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    specialite_id UUID NOT NULL REFERENCES public.specialites(id),
    site_preferentiel_id UUID REFERENCES public.sites(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des secrétaires
CREATE TABLE public.secretaires (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    specialites UUID[] NOT NULL DEFAULT '{}',
    site_preferentiel_id UUID REFERENCES public.sites(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des horaires de base des médecins
CREATE TABLE public.horaires_base_medecins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medecin_id UUID NOT NULL REFERENCES public.medecins(id) ON DELETE CASCADE,
    jour_semaine INTEGER NOT NULL CHECK (jour_semaine >= 1 AND jour_semaine <= 7),
    heure_debut TIME NOT NULL,
    heure_fin TIME NOT NULL,
    site_id UUID NOT NULL REFERENCES public.sites(id),
    actif BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des horaires de base des secrétaires
CREATE TABLE public.horaires_base_secretaires (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    secretaire_id UUID NOT NULL REFERENCES public.secretaires(id) ON DELETE CASCADE,
    jour_semaine INTEGER NOT NULL CHECK (jour_semaine >= 1 AND jour_semaine <= 7),
    heure_debut TIME NOT NULL,
    heure_fin TIME NOT NULL,
    site_id UUID NOT NULL REFERENCES public.sites(id),
    type public.type_horaire NOT NULL DEFAULT 'fixe',
    actif BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des absences
CREATE TABLE public.absences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    type public.type_absence NOT NULL,
    motif TEXT,
    statut public.statut_absence DEFAULT 'en_attente' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des besoins en secrétaires par médecin
CREATE TABLE public.besoins_secretaires_par_medecin (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medecin_id UUID NOT NULL REFERENCES public.medecins(id) ON DELETE CASCADE,
    nombre_secretaires_requis DECIMAL DEFAULT 1.0 NOT NULL,
    facteur_ajustement DECIMAL DEFAULT 1.0 NOT NULL,
    actif BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table des besoins par site
CREATE TABLE public.besoins_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    specialite_id UUID NOT NULL REFERENCES public.specialites(id),
    nombre_medecins_requis INTEGER NOT NULL,
    priorite public.priorite_besoin DEFAULT 'moyenne' NOT NULL,
    actif BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Table du planning généré
CREATE TABLE public.planning_genere (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    medecin_id UUID REFERENCES public.medecins(id),
    secretaire_id UUID REFERENCES public.secretaires(id),
    site_id UUID NOT NULL REFERENCES public.sites(id),
    heure_debut TIME NOT NULL,
    heure_fin TIME NOT NULL,
    type public.type_planning NOT NULL,
    statut public.statut_planning DEFAULT 'planifie' NOT NULL,
    version_planning INTEGER DEFAULT 1 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Triggers pour updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sites_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_specialites_updated_at BEFORE UPDATE ON public.specialites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_medecins_updated_at BEFORE UPDATE ON public.medecins FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_secretaires_updated_at BEFORE UPDATE ON public.secretaires FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_horaires_base_medecins_updated_at BEFORE UPDATE ON public.horaires_base_medecins FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_horaires_base_secretaires_updated_at BEFORE UPDATE ON public.horaires_base_secretaires FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_absences_updated_at BEFORE UPDATE ON public.absences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_besoins_secretaires_par_medecin_updated_at BEFORE UPDATE ON public.besoins_secretaires_par_medecin FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_besoins_sites_updated_at BEFORE UPDATE ON public.besoins_sites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_planning_genere_updated_at BEFORE UPDATE ON public.planning_genere FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Fonction sécurisée pour obtenir le rôle de l'utilisateur actuel (évite la récursion RLS)
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Fonction pour vérifier si l'utilisateur est admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.get_current_user_role() = 'admin', FALSE);
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Activer RLS sur toutes les tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medecins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secretaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horaires_base_medecins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horaires_base_secretaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.besoins_secretaires_par_medecin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.besoins_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_genere ENABLE ROW LEVEL SECURITY;

-- Politiques RLS pour profiles
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (TRUE);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can do everything on profiles" ON public.profiles FOR ALL USING (public.is_admin());

-- Politiques RLS pour sites (lecture pour tous, écriture pour admins)
CREATE POLICY "Users can view all sites" ON public.sites FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage sites" ON public.sites FOR ALL USING (public.is_admin());

-- Politiques RLS pour specialites (lecture pour tous, écriture pour admins)
CREATE POLICY "Users can view all specialites" ON public.specialites FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage specialites" ON public.specialites FOR ALL USING (public.is_admin());

-- Politiques RLS pour medecins
CREATE POLICY "Users can view all medecins" ON public.medecins FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage medecins" ON public.medecins FOR ALL USING (public.is_admin());

-- Politiques RLS pour secretaires
CREATE POLICY "Users can view all secretaires" ON public.secretaires FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage secretaires" ON public.secretaires FOR ALL USING (public.is_admin());

-- Politiques RLS pour horaires_base_medecins
CREATE POLICY "Users can view all horaires medecins" ON public.horaires_base_medecins FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage horaires medecins" ON public.horaires_base_medecins FOR ALL USING (public.is_admin());

-- Politiques RLS pour horaires_base_secretaires
CREATE POLICY "Users can view all horaires secretaires" ON public.horaires_base_secretaires FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage horaires secretaires" ON public.horaires_base_secretaires FOR ALL USING (public.is_admin());

-- Politiques RLS pour absences
CREATE POLICY "Users can view all absences" ON public.absences FOR SELECT USING (TRUE);
CREATE POLICY "Users can manage own absences" ON public.absences 
  FOR ALL USING (auth.uid() = profile_id OR public.is_admin());

-- Politiques RLS pour besoins_secretaires_par_medecin
CREATE POLICY "Users can view besoins secretaires" ON public.besoins_secretaires_par_medecin FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage besoins secretaires" ON public.besoins_secretaires_par_medecin FOR ALL USING (public.is_admin());

-- Politiques RLS pour besoins_sites
CREATE POLICY "Users can view besoins sites" ON public.besoins_sites FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage besoins sites" ON public.besoins_sites FOR ALL USING (public.is_admin());

-- Politiques RLS pour planning_genere
CREATE POLICY "Users can view all planning" ON public.planning_genere FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage planning" ON public.planning_genere FOR ALL USING (public.is_admin());

-- Trigger pour créer automatiquement un profil lors de l'inscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, role, prenom, nom, email)
  VALUES (
    NEW.id,
    'medecin', -- rôle par défaut, à modifier après création
    COALESCE(NEW.raw_user_meta_data ->> 'prenom', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'nom', ''),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();