export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      absences: {
        Row: {
          created_at: string
          date_debut: string
          date_fin: string
          heure_debut: string | null
          heure_fin: string | null
          id: string
          medecin_id: string | null
          motif: string | null
          secretaire_id: string | null
          statut: Database["public"]["Enums"]["statut_absence"]
          type: Database["public"]["Enums"]["type_absence"]
          type_personne: Database["public"]["Enums"]["type_personne"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_debut: string
          date_fin: string
          heure_debut?: string | null
          heure_fin?: string | null
          id?: string
          medecin_id?: string | null
          motif?: string | null
          secretaire_id?: string | null
          statut?: Database["public"]["Enums"]["statut_absence"]
          type: Database["public"]["Enums"]["type_absence"]
          type_personne: Database["public"]["Enums"]["type_personne"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_debut?: string
          date_fin?: string
          heure_debut?: string | null
          heure_fin?: string | null
          id?: string
          medecin_id?: string | null
          motif?: string | null
          secretaire_id?: string | null
          statut?: Database["public"]["Enums"]["statut_absence"]
          type?: Database["public"]["Enums"]["type_absence"]
          type_personne?: Database["public"]["Enums"]["type_personne"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "absences_medecin_id_fkey"
            columns: ["medecin_id"]
            isOneToOne: false
            referencedRelation: "medecins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absences_secretaire_id_fkey"
            columns: ["secretaire_id"]
            isOneToOne: false
            referencedRelation: "secretaires"
            referencedColumns: ["id"]
          },
        ]
      }
      backup: {
        Row: {
          actif: boolean
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          name: string | null
          phone_number: string | null
          specialites: string[]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          name?: string | null
          phone_number?: string | null
          specialites?: string[]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          name?: string | null
          phone_number?: string | null
          specialites?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      besoin_effectif: {
        Row: {
          actif: boolean
          bloc_operatoire_besoin_id: string | null
          created_at: string
          date: string
          heure_debut: string
          heure_fin: string
          id: string
          medecin_id: string | null
          site_id: string
          type: Database["public"]["Enums"]["type_besoin"]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          bloc_operatoire_besoin_id?: string | null
          created_at?: string
          date: string
          heure_debut: string
          heure_fin: string
          id?: string
          medecin_id?: string | null
          site_id: string
          type: Database["public"]["Enums"]["type_besoin"]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          bloc_operatoire_besoin_id?: string | null
          created_at?: string
          date?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
          medecin_id?: string | null
          site_id?: string
          type?: Database["public"]["Enums"]["type_besoin"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "besoin_effectif_bloc_operatoire_besoin_id_fkey"
            columns: ["bloc_operatoire_besoin_id"]
            isOneToOne: false
            referencedRelation: "bloc_operatoire_besoins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "besoin_effectif_medecin_id_fkey"
            columns: ["medecin_id"]
            isOneToOne: false
            referencedRelation: "medecins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "besoin_effectif_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      besoins_sites: {
        Row: {
          actif: boolean
          created_at: string
          id: string
          nombre_medecins_requis: number
          priorite: Database["public"]["Enums"]["priorite_besoin"]
          site_id: string
          specialite_id: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          id?: string
          nombre_medecins_requis: number
          priorite?: Database["public"]["Enums"]["priorite_besoin"]
          site_id: string
          specialite_id: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          id?: string
          nombre_medecins_requis?: number
          priorite?: Database["public"]["Enums"]["priorite_besoin"]
          site_id?: string
          specialite_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "besoins_sites_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "besoins_sites_specialite_id_fkey"
            columns: ["specialite_id"]
            isOneToOne: false
            referencedRelation: "specialites"
            referencedColumns: ["id"]
          },
        ]
      }
      bloc_operatoire_besoins: {
        Row: {
          actif: boolean
          created_at: string
          date: string
          heure_debut: string
          heure_fin: string
          id: string
          nombre_secretaires_requis: number
          specialite_id: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          date: string
          heure_debut: string
          heure_fin: string
          id?: string
          nombre_secretaires_requis?: number
          specialite_id: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          date?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
          nombre_secretaires_requis?: number
          specialite_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloc_operatoire_besoins_specialite_id_fkey"
            columns: ["specialite_id"]
            isOneToOne: false
            referencedRelation: "specialites"
            referencedColumns: ["id"]
          },
        ]
      }
      capacite_effective: {
        Row: {
          actif: boolean
          backup_id: string | null
          created_at: string
          date: string
          heure_debut: string
          heure_fin: string
          id: string
          secretaire_id: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          backup_id?: string | null
          created_at?: string
          date: string
          heure_debut: string
          heure_fin: string
          id?: string
          secretaire_id?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          backup_id?: string | null
          created_at?: string
          date?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
          secretaire_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capacite_effective_backup_id_fkey"
            columns: ["backup_id"]
            isOneToOne: false
            referencedRelation: "backup"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacite_effective_secretaire_id_fkey"
            columns: ["secretaire_id"]
            isOneToOne: false
            referencedRelation: "secretaires"
            referencedColumns: ["id"]
          },
        ]
      }
      horaires_base_medecins: {
        Row: {
          actif: boolean
          alternance_semaine_reference: string | null
          alternance_type: Database["public"]["Enums"]["type_alternance"] | null
          created_at: string
          heure_debut: string
          heure_fin: string
          id: string
          jour_semaine: number
          medecin_id: string
          site_id: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          alternance_semaine_reference?: string | null
          alternance_type?:
            | Database["public"]["Enums"]["type_alternance"]
            | null
          created_at?: string
          heure_debut: string
          heure_fin: string
          id?: string
          jour_semaine: number
          medecin_id: string
          site_id: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          alternance_semaine_reference?: string | null
          alternance_type?:
            | Database["public"]["Enums"]["type_alternance"]
            | null
          created_at?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
          jour_semaine?: number
          medecin_id?: string
          site_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "horaires_base_medecins_medecin_id_fkey"
            columns: ["medecin_id"]
            isOneToOne: false
            referencedRelation: "medecins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "horaires_base_medecins_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      horaires_base_secretaires: {
        Row: {
          actif: boolean
          created_at: string
          heure_debut: string
          heure_fin: string
          id: string
          jour_semaine: number
          secretaire_id: string
          type: Database["public"]["Enums"]["type_horaire"]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          heure_debut: string
          heure_fin: string
          id?: string
          jour_semaine: number
          secretaire_id: string
          type?: Database["public"]["Enums"]["type_horaire"]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
          jour_semaine?: number
          secretaire_id?: string
          type?: Database["public"]["Enums"]["type_horaire"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "horaires_base_secretaires_secretaire_id_fkey"
            columns: ["secretaire_id"]
            isOneToOne: false
            referencedRelation: "secretaires"
            referencedColumns: ["id"]
          },
        ]
      }
      horaires_effectifs: {
        Row: {
          actif: boolean
          created_at: string
          date: string
          heure_debut: string
          heure_fin: string
          id: string
          personne_id: string
          reference_id: string | null
          site_id: string
          source: Database["public"]["Enums"]["source_horaire"]
          specialite_id: string | null
          specialites: string[] | null
          statut: Database["public"]["Enums"]["statut_horaire"]
          type_personne: Database["public"]["Enums"]["type_personne"]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          date: string
          heure_debut: string
          heure_fin: string
          id?: string
          personne_id: string
          reference_id?: string | null
          site_id: string
          source?: Database["public"]["Enums"]["source_horaire"]
          specialite_id?: string | null
          specialites?: string[] | null
          statut?: Database["public"]["Enums"]["statut_horaire"]
          type_personne: Database["public"]["Enums"]["type_personne"]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          date?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
          personne_id?: string
          reference_id?: string | null
          site_id?: string
          source?: Database["public"]["Enums"]["source_horaire"]
          specialite_id?: string | null
          specialites?: string[] | null
          statut?: Database["public"]["Enums"]["statut_horaire"]
          type_personne?: Database["public"]["Enums"]["type_personne"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "horaires_effectifs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "horaires_effectifs_specialite_id_fkey"
            columns: ["specialite_id"]
            isOneToOne: false
            referencedRelation: "specialites"
            referencedColumns: ["id"]
          },
        ]
      }
      medecins: {
        Row: {
          actif: boolean
          besoin_secretaires: number
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          name: string | null
          phone_number: string | null
          profile_id: string | null
          specialite_id: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          besoin_secretaires?: number
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          name?: string | null
          phone_number?: string | null
          profile_id?: string | null
          specialite_id: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          besoin_secretaires?: number
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          name?: string | null
          phone_number?: string | null
          profile_id?: string | null
          specialite_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medecins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medecins_specialite_id_fkey"
            columns: ["specialite_id"]
            isOneToOne: false
            referencedRelation: "specialites"
            referencedColumns: ["id"]
          },
        ]
      }
      optimisation_horaires_base: {
        Row: {
          besoins: number
          capacites_assignees: number
          created_at: string
          demi_journee: string
          id: string
          jour_semaine: number
          secretaires_assignees: string[]
          specialite_id: string
          updated_at: string
        }
        Insert: {
          besoins?: number
          capacites_assignees?: number
          created_at?: string
          demi_journee: string
          id?: string
          jour_semaine: number
          secretaires_assignees?: string[]
          specialite_id: string
          updated_at?: string
        }
        Update: {
          besoins?: number
          capacites_assignees?: number
          created_at?: string
          demi_journee?: string
          id?: string
          jour_semaine?: number
          secretaires_assignees?: string[]
          specialite_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "optimisation_horaires_base_specialite_id_fkey"
            columns: ["specialite_id"]
            isOneToOne: false
            referencedRelation: "specialites"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_genere: {
        Row: {
          backups_ids: string[] | null
          created_at: string
          date: string
          heure_debut: string
          heure_fin: string
          id: string
          medecins_ids: string[] | null
          responsable_1r_id: string | null
          responsable_2f_id: string | null
          secretaires_ids: string[] | null
          site_id: string | null
          statut: Database["public"]["Enums"]["statut_planning"]
          type: Database["public"]["Enums"]["type_planning"]
          type_assignation: string | null
          updated_at: string
          version_planning: number
        }
        Insert: {
          backups_ids?: string[] | null
          created_at?: string
          date: string
          heure_debut: string
          heure_fin: string
          id?: string
          medecins_ids?: string[] | null
          responsable_1r_id?: string | null
          responsable_2f_id?: string | null
          secretaires_ids?: string[] | null
          site_id?: string | null
          statut?: Database["public"]["Enums"]["statut_planning"]
          type: Database["public"]["Enums"]["type_planning"]
          type_assignation?: string | null
          updated_at?: string
          version_planning?: number
        }
        Update: {
          backups_ids?: string[] | null
          created_at?: string
          date?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
          medecins_ids?: string[] | null
          responsable_1r_id?: string | null
          responsable_2f_id?: string | null
          secretaires_ids?: string[] | null
          site_id?: string | null
          statut?: Database["public"]["Enums"]["statut_planning"]
          type?: Database["public"]["Enums"]["type_planning"]
          type_assignation?: string | null
          updated_at?: string
          version_planning?: number
        }
        Relationships: [
          {
            foreignKeyName: "planning_genere_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nom: string
          planning: boolean
          prenom: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          nom: string
          planning?: boolean
          prenom: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nom?: string
          planning?: boolean
          prenom?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      secretaires: {
        Row: {
          actif: boolean
          created_at: string
          email: string | null
          first_name: string | null
          flexible_jours_supplementaires: boolean
          id: string
          name: string | null
          nombre_jours_supplementaires: number | null
          phone_number: string | null
          prefere_port_en_truie: boolean
          profile_id: string | null
          site_preferentiel_id: string | null
          specialites: string[]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          flexible_jours_supplementaires?: boolean
          id?: string
          name?: string | null
          nombre_jours_supplementaires?: number | null
          phone_number?: string | null
          prefere_port_en_truie?: boolean
          profile_id?: string | null
          site_preferentiel_id?: string | null
          specialites?: string[]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          flexible_jours_supplementaires?: boolean
          id?: string
          name?: string | null
          nombre_jours_supplementaires?: number | null
          phone_number?: string | null
          prefere_port_en_truie?: boolean
          profile_id?: string | null
          site_preferentiel_id?: string | null
          specialites?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "secretaires_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secretaires_site_preferentiel_id_fkey"
            columns: ["site_preferentiel_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          actif: boolean
          adresse: string
          created_at: string
          fermeture: boolean
          id: string
          nom: string
          specialite_id: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          adresse: string
          created_at?: string
          fermeture?: boolean
          id?: string
          nom: string
          specialite_id?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          adresse?: string
          created_at?: string
          fermeture?: boolean
          id?: string
          nom?: string
          specialite_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_specialite_id_fkey"
            columns: ["specialite_id"]
            isOneToOne: false
            referencedRelation: "specialites"
            referencedColumns: ["id"]
          },
        ]
      }
      specialites: {
        Row: {
          code: string
          created_at: string
          id: string
          nom: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          nom: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          nom?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_besoin_from_bloc: {
        Args: { p_bloc_id: string }
        Returns: undefined
      }
      generate_besoin_effectif: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      generate_capacite_effective: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      get_current_user_role: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["user_role"]
      }
      handle_horaire_medecin_insert_logic: {
        Args: { p_horaire: Record<string, unknown> }
        Returns: undefined
      }
      handle_horaire_secretaire_insert_logic: {
        Args: { p_horaire: Record<string, unknown> }
        Returns: undefined
      }
      has_planning_access: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      recalculate_base_schedule_optimization: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      recreate_doctor_besoin: {
        Args: { p_date_debut: string; p_date_fin: string; p_medecin_id: string }
        Returns: undefined
      }
      recreate_secretary_capacite: {
        Args: {
          p_date_debut: string
          p_date_fin: string
          p_secretaire_id: string
        }
        Returns: undefined
      }
      should_doctor_work: {
        Args: {
          p_alternance_reference: string
          p_alternance_type: Database["public"]["Enums"]["type_alternance"]
          p_target_date: string
        }
        Returns: boolean
      }
      weekly_planning_maintenance: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
    }
    Enums: {
      priorite_besoin: "haute" | "moyenne" | "basse"
      source_horaire: "horaire_base" | "bloc_operatoire" | "absence"
      statut_absence: "en_attente" | "approuve" | "refuse"
      statut_horaire: "disponible" | "absent" | "bloc_operatoire"
      statut_planning: "planifie" | "confirme" | "absent"
      type_absence: "conges" | "maladie" | "formation" | "autre"
      type_alternance:
        | "hebdomadaire"
        | "une_sur_deux"
        | "une_sur_trois"
        | "une_sur_quatre"
      type_besoin: "medecin" | "bloc_operatoire"
      type_horaire: "fixe" | "disponible"
      type_personne: "medecin" | "secretaire"
      type_planning: "medecin" | "secretaire"
      user_role: "admin" | "medecin" | "secretaire"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      priorite_besoin: ["haute", "moyenne", "basse"],
      source_horaire: ["horaire_base", "bloc_operatoire", "absence"],
      statut_absence: ["en_attente", "approuve", "refuse"],
      statut_horaire: ["disponible", "absent", "bloc_operatoire"],
      statut_planning: ["planifie", "confirme", "absent"],
      type_absence: ["conges", "maladie", "formation", "autre"],
      type_alternance: [
        "hebdomadaire",
        "une_sur_deux",
        "une_sur_trois",
        "une_sur_quatre",
      ],
      type_besoin: ["medecin", "bloc_operatoire"],
      type_horaire: ["fixe", "disponible"],
      type_personne: ["medecin", "secretaire"],
      type_planning: ["medecin", "secretaire"],
      user_role: ["admin", "medecin", "secretaire"],
    },
  },
} as const
