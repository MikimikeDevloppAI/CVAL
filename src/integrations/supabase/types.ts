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
          id: string
          motif: string | null
          profile_id: string
          statut: Database["public"]["Enums"]["statut_absence"]
          type: Database["public"]["Enums"]["type_absence"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_debut: string
          date_fin: string
          id?: string
          motif?: string | null
          profile_id: string
          statut?: Database["public"]["Enums"]["statut_absence"]
          type: Database["public"]["Enums"]["type_absence"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_debut?: string
          date_fin?: string
          id?: string
          motif?: string | null
          profile_id?: string
          statut?: Database["public"]["Enums"]["statut_absence"]
          type?: Database["public"]["Enums"]["type_absence"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "absences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      besoins_secretaires_par_medecin: {
        Row: {
          actif: boolean
          created_at: string
          facteur_ajustement: number
          id: string
          medecin_id: string
          nombre_secretaires_requis: number
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          facteur_ajustement?: number
          id?: string
          medecin_id: string
          nombre_secretaires_requis?: number
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          facteur_ajustement?: number
          id?: string
          medecin_id?: string
          nombre_secretaires_requis?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "besoins_secretaires_par_medecin_medecin_id_fkey"
            columns: ["medecin_id"]
            isOneToOne: false
            referencedRelation: "medecins"
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
      horaires_base_medecins: {
        Row: {
          actif: boolean
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
      medecins: {
        Row: {
          actif: boolean
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
      planning_genere: {
        Row: {
          created_at: string
          date: string
          heure_debut: string
          heure_fin: string
          id: string
          medecin_id: string | null
          secretaire_id: string | null
          site_id: string
          statut: Database["public"]["Enums"]["statut_planning"]
          type: Database["public"]["Enums"]["type_planning"]
          updated_at: string
          version_planning: number
        }
        Insert: {
          created_at?: string
          date: string
          heure_debut: string
          heure_fin: string
          id?: string
          medecin_id?: string | null
          secretaire_id?: string | null
          site_id: string
          statut?: Database["public"]["Enums"]["statut_planning"]
          type: Database["public"]["Enums"]["type_planning"]
          updated_at?: string
          version_planning?: number
        }
        Update: {
          created_at?: string
          date?: string
          heure_debut?: string
          heure_fin?: string
          id?: string
          medecin_id?: string | null
          secretaire_id?: string | null
          site_id?: string
          statut?: Database["public"]["Enums"]["statut_planning"]
          type?: Database["public"]["Enums"]["type_planning"]
          updated_at?: string
          version_planning?: number
        }
        Relationships: [
          {
            foreignKeyName: "planning_genere_medecin_id_fkey"
            columns: ["medecin_id"]
            isOneToOne: false
            referencedRelation: "medecins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_genere_secretaire_id_fkey"
            columns: ["secretaire_id"]
            isOneToOne: false
            referencedRelation: "secretaires"
            referencedColumns: ["id"]
          },
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
          prenom: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          nom: string
          prenom: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nom?: string
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
          updated_at: string
        }
        Insert: {
          actif?: boolean
          adresse: string
          created_at?: string
          fermeture?: boolean
          id?: string
          nom: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          adresse?: string
          created_at?: string
          fermeture?: boolean
          id?: string
          nom?: string
          updated_at?: string
        }
        Relationships: []
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
      get_current_user_role: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      priorite_besoin: "haute" | "moyenne" | "basse"
      statut_absence: "en_attente" | "approuve" | "refuse"
      statut_planning: "planifie" | "confirme" | "absent"
      type_absence: "conges" | "maladie" | "formation" | "autre"
      type_horaire: "fixe" | "disponible"
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
      statut_absence: ["en_attente", "approuve", "refuse"],
      statut_planning: ["planifie", "confirme", "absent"],
      type_absence: ["conges", "maladie", "formation", "autre"],
      type_horaire: ["fixe", "disponible"],
      type_planning: ["medecin", "secretaire"],
      user_role: ["admin", "medecin", "secretaire"],
    },
  },
} as const
