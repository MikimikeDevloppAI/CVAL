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
          created_at: string
          date: string
          demi_journee: Database["public"]["Enums"]["demi_journee"]
          id: string
          medecin_id: string | null
          site_id: string
          type: Database["public"]["Enums"]["type_besoin"]
          type_intervention_id: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          date: string
          demi_journee: Database["public"]["Enums"]["demi_journee"]
          id?: string
          medecin_id?: string | null
          site_id: string
          type: Database["public"]["Enums"]["type_besoin"]
          type_intervention_id?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          date?: string
          demi_journee?: Database["public"]["Enums"]["demi_journee"]
          id?: string
          medecin_id?: string | null
          site_id?: string
          type?: Database["public"]["Enums"]["type_besoin"]
          type_intervention_id?: string | null
          updated_at?: string
        }
        Relationships: [
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
          {
            foreignKeyName: "besoin_effectif_type_intervention_id_fkey"
            columns: ["type_intervention_id"]
            isOneToOne: false
            referencedRelation: "types_intervention"
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
          type_intervention_id: string | null
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
          type_intervention_id?: string | null
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
          type_intervention_id?: string | null
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
          {
            foreignKeyName: "bloc_operatoire_besoins_type_intervention_id_fkey"
            columns: ["type_intervention_id"]
            isOneToOne: false
            referencedRelation: "types_intervention"
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
          demi_journee: Database["public"]["Enums"]["demi_journee"]
          id: string
          secretaire_id: string | null
          site_id: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          backup_id?: string | null
          created_at?: string
          date: string
          demi_journee: Database["public"]["Enums"]["demi_journee"]
          id?: string
          secretaire_id?: string | null
          site_id?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          backup_id?: string | null
          created_at?: string
          date?: string
          demi_journee?: Database["public"]["Enums"]["demi_journee"]
          id?: string
          secretaire_id?: string | null
          site_id?: string | null
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
          {
            foreignKeyName: "capacite_effective_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      configurations_multi_flux: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          id: string
          nom: string
          type_flux: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          id?: string
          nom: string
          type_flux: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          id?: string
          nom?: string
          type_flux?: string
          updated_at?: string
        }
        Relationships: []
      }
      configurations_multi_flux_interventions: {
        Row: {
          configuration_id: string
          created_at: string
          id: string
          ordre: number
          salle: string
          type_intervention_id: string
        }
        Insert: {
          configuration_id: string
          created_at?: string
          id?: string
          ordre: number
          salle: string
          type_intervention_id: string
        }
        Update: {
          configuration_id?: string
          created_at?: string
          id?: string
          ordre?: number
          salle?: string
          type_intervention_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "configurations_multi_flux_interventio_type_intervention_id_fkey"
            columns: ["type_intervention_id"]
            isOneToOne: false
            referencedRelation: "types_intervention"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configurations_multi_flux_interventions_configuration_id_fkey"
            columns: ["configuration_id"]
            isOneToOne: false
            referencedRelation: "configurations_multi_flux"
            referencedColumns: ["id"]
          },
        ]
      }
      horaires_base_medecins: {
        Row: {
          actif: boolean
          alternance_semaine_modulo: number
          alternance_type: Database["public"]["Enums"]["type_alternance"] | null
          created_at: string
          date_debut: string | null
          date_fin: string | null
          demi_journee: Database["public"]["Enums"]["demi_journee"]
          id: string
          jour_semaine: number
          medecin_id: string
          site_id: string
          type_intervention_id: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          alternance_semaine_modulo?: number
          alternance_type?:
            | Database["public"]["Enums"]["type_alternance"]
            | null
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          demi_journee: Database["public"]["Enums"]["demi_journee"]
          id?: string
          jour_semaine: number
          medecin_id: string
          site_id: string
          type_intervention_id?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          alternance_semaine_modulo?: number
          alternance_type?:
            | Database["public"]["Enums"]["type_alternance"]
            | null
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          demi_journee?: Database["public"]["Enums"]["demi_journee"]
          id?: string
          jour_semaine?: number
          medecin_id?: string
          site_id?: string
          type_intervention_id?: string | null
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
          {
            foreignKeyName: "horaires_base_medecins_type_intervention_id_fkey"
            columns: ["type_intervention_id"]
            isOneToOne: false
            referencedRelation: "types_intervention"
            referencedColumns: ["id"]
          },
        ]
      }
      horaires_base_secretaires: {
        Row: {
          actif: boolean
          alternance_semaine_modulo: number | null
          alternance_type: Database["public"]["Enums"]["type_alternance"] | null
          created_at: string
          date_debut: string | null
          date_fin: string | null
          demi_journee: Database["public"]["Enums"]["demi_journee"]
          id: string
          jour_semaine: number
          secretaire_id: string
          site_id: string | null
          type: Database["public"]["Enums"]["type_horaire"]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          alternance_semaine_modulo?: number | null
          alternance_type?:
            | Database["public"]["Enums"]["type_alternance"]
            | null
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          demi_journee: Database["public"]["Enums"]["demi_journee"]
          id?: string
          jour_semaine: number
          secretaire_id: string
          site_id?: string | null
          type?: Database["public"]["Enums"]["type_horaire"]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          alternance_semaine_modulo?: number | null
          alternance_type?:
            | Database["public"]["Enums"]["type_alternance"]
            | null
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          demi_journee?: Database["public"]["Enums"]["demi_journee"]
          id?: string
          jour_semaine?: number
          secretaire_id?: string
          site_id?: string | null
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
          {
            foreignKeyName: "horaires_base_secretaires_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
      jours_feries: {
        Row: {
          actif: boolean
          created_at: string
          date: string
          id: string
          nom: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          date: string
          id?: string
          nom: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          date?: string
          id?: string
          nom?: string
          updated_at?: string
        }
        Relationships: []
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
      planning: {
        Row: {
          created_at: string
          date_debut: string
          date_fin: string
          date_generation: string
          id: string
          pdf_url: string | null
          statut: string
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          created_at?: string
          date_debut: string
          date_fin: string
          date_generation?: string
          id?: string
          pdf_url?: string | null
          statut?: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          created_at?: string
          date_debut?: string
          date_fin?: string
          date_generation?: string
          id?: string
          pdf_url?: string | null
          statut?: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: []
      }
      planning_genere_bloc_operatoire: {
        Row: {
          created_at: string
          date: string
          id: string
          medecin_id: string | null
          periode: Database["public"]["Enums"]["demi_journee"]
          planning_id: string | null
          salle_assignee: string | null
          statut: Database["public"]["Enums"]["statut_planning"]
          type_intervention_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          medecin_id?: string | null
          periode: Database["public"]["Enums"]["demi_journee"]
          planning_id?: string | null
          salle_assignee?: string | null
          statut?: Database["public"]["Enums"]["statut_planning"]
          type_intervention_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          medecin_id?: string | null
          periode?: Database["public"]["Enums"]["demi_journee"]
          planning_id?: string | null
          salle_assignee?: string | null
          statut?: Database["public"]["Enums"]["statut_planning"]
          type_intervention_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_genere_bloc_operatoire_medecin_id_fkey"
            columns: ["medecin_id"]
            isOneToOne: false
            referencedRelation: "medecins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_genere_bloc_operatoire_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "planning"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_genere_bloc_operatoire_type_intervention_id_fkey"
            columns: ["type_intervention_id"]
            isOneToOne: false
            referencedRelation: "types_intervention"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_genere_personnel: {
        Row: {
          besoin_effectif_id: string | null
          created_at: string | null
          date: string
          id: string
          ordre: number
          periode: Database["public"]["Enums"]["periode"]
          planning_genere_bloc_operatoire_id: string | null
          planning_id: string | null
          secretaire_id: string | null
          type_assignation: string
          type_besoin_bloc:
            | Database["public"]["Enums"]["type_besoin_personnel"]
            | null
          updated_at: string | null
        }
        Insert: {
          besoin_effectif_id?: string | null
          created_at?: string | null
          date: string
          id?: string
          ordre?: number
          periode: Database["public"]["Enums"]["periode"]
          planning_genere_bloc_operatoire_id?: string | null
          planning_id?: string | null
          secretaire_id?: string | null
          type_assignation: string
          type_besoin_bloc?:
            | Database["public"]["Enums"]["type_besoin_personnel"]
            | null
          updated_at?: string | null
        }
        Update: {
          besoin_effectif_id?: string | null
          created_at?: string | null
          date?: string
          id?: string
          ordre?: number
          periode?: Database["public"]["Enums"]["periode"]
          planning_genere_bloc_operatoire_id?: string | null
          planning_id?: string | null
          secretaire_id?: string | null
          type_assignation?: string
          type_besoin_bloc?:
            | Database["public"]["Enums"]["type_besoin_personnel"]
            | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planning_genere_personnel_besoin_effectif_id_fkey"
            columns: ["besoin_effectif_id"]
            isOneToOne: false
            referencedRelation: "besoin_effectif"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_genere_personnel_planning_genere_bloc_operatoire__fkey"
            columns: ["planning_genere_bloc_operatoire_id"]
            isOneToOne: false
            referencedRelation: "planning_genere_bloc_operatoire"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_genere_personnel_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "planning"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_genere_personnel_secretaire_id_fkey"
            columns: ["secretaire_id"]
            isOneToOne: false
            referencedRelation: "secretaires"
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          nom: string
          planning?: boolean
          prenom: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nom?: string
          planning?: boolean
          prenom?: string
          updated_at?: string
        }
        Relationships: []
      }
      secretaires: {
        Row: {
          actif: boolean
          aide_de_salle: boolean
          anesthesiste: boolean
          assignation_administrative: boolean
          bloc_dermato_accueil: boolean
          bloc_ophtalmo_accueil: boolean
          created_at: string
          email: string | null
          first_name: string | null
          flexible_jours_supplementaires: boolean
          horaire_flexible: boolean
          id: string
          instrumentaliste: boolean
          medecin_assigne_id: string | null
          name: string | null
          nombre_jours_supplementaires: number | null
          personnel_bloc_operatoire: boolean
          phone_number: string | null
          pourcentage_temps: number | null
          prefere_port_en_truie: boolean
          profile_id: string | null
          site_preferentiel_id: string | null
          sites_assignes: string[]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          aide_de_salle?: boolean
          anesthesiste?: boolean
          assignation_administrative?: boolean
          bloc_dermato_accueil?: boolean
          bloc_ophtalmo_accueil?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          flexible_jours_supplementaires?: boolean
          horaire_flexible?: boolean
          id?: string
          instrumentaliste?: boolean
          medecin_assigne_id?: string | null
          name?: string | null
          nombre_jours_supplementaires?: number | null
          personnel_bloc_operatoire?: boolean
          phone_number?: string | null
          pourcentage_temps?: number | null
          prefere_port_en_truie?: boolean
          profile_id?: string | null
          site_preferentiel_id?: string | null
          sites_assignes?: string[]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          aide_de_salle?: boolean
          anesthesiste?: boolean
          assignation_administrative?: boolean
          bloc_dermato_accueil?: boolean
          bloc_ophtalmo_accueil?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          flexible_jours_supplementaires?: boolean
          horaire_flexible?: boolean
          id?: string
          instrumentaliste?: boolean
          medecin_assigne_id?: string | null
          name?: string | null
          nombre_jours_supplementaires?: number | null
          personnel_bloc_operatoire?: boolean
          phone_number?: string | null
          pourcentage_temps?: number | null
          prefere_port_en_truie?: boolean
          profile_id?: string | null
          site_preferentiel_id?: string | null
          sites_assignes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "secretaires_medecin_assigne_id_fkey"
            columns: ["medecin_assigne_id"]
            isOneToOne: false
            referencedRelation: "medecins"
            referencedColumns: ["id"]
          },
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
      types_intervention: {
        Row: {
          actif: boolean | null
          code: string
          created_at: string | null
          id: string
          nom: string
          salle_preferentielle: string | null
          updated_at: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          created_at?: string | null
          id?: string
          nom: string
          salle_preferentielle?: string | null
          updated_at?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          created_at?: string | null
          id?: string
          nom?: string
          salle_preferentielle?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      types_intervention_besoins_personnel: {
        Row: {
          actif: boolean
          created_at: string
          id: string
          nombre_requis: number
          type_besoin: Database["public"]["Enums"]["type_besoin_personnel"]
          type_intervention_id: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          id?: string
          nombre_requis?: number
          type_besoin: Database["public"]["Enums"]["type_besoin_personnel"]
          type_intervention_id: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          id?: string
          nombre_requis?: number
          type_besoin?: Database["public"]["Enums"]["type_besoin_personnel"]
          type_intervention_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "types_intervention_besoins_personnel_type_intervention_id_fkey"
            columns: ["type_intervention_id"]
            isOneToOne: false
            referencedRelation: "types_intervention"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
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
      get_user_primary_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
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
      has_planning_or_admin_access: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
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
      recreate_besoins_capacites_for_date: {
        Args: { p_date: string }
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
        Args:
          | {
              p_alternance_modulo: number
              p_alternance_type: Database["public"]["Enums"]["type_alternance"]
              p_target_date: string
            }
          | {
              p_alternance_reference: string
              p_alternance_type: Database["public"]["Enums"]["type_alternance"]
              p_target_date: string
            }
        Returns: boolean
      }
      swap_secretaries: {
        Args: {
          p_date: string
          p_period: string
          p_secretary_id_1: string
          p_secretary_id_2: string
        }
        Returns: Json
      }
      update_user_role: {
        Args: {
          _new_role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      update_user_role_upsert: {
        Args: {
          _new_role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      weekly_planning_maintenance: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "medecin" | "secretaire"
      demi_journee: "matin" | "apres_midi" | "toute_journee"
      periode: "matin" | "apres_midi"
      priorite_besoin: "haute" | "moyenne" | "basse"
      source_horaire: "horaire_base" | "bloc_operatoire" | "absence"
      statut_absence: "en_attente" | "approuve" | "refuse"
      statut_horaire: "disponible" | "absent" | "bloc_operatoire"
      statut_planning: "planifie" | "confirme" | "absent" | "annule"
      type_absence: "conges" | "maladie" | "formation" | "autre"
      type_alternance:
        | "hebdomadaire"
        | "une_sur_deux"
        | "une_sur_trois"
        | "une_sur_quatre"
      type_besoin: "medecin" | "bloc_operatoire"
      type_besoin_personnel:
        | "anesthesiste"
        | "instrumentiste"
        | "instrumentiste_aide_salle"
        | "aide_salle"
        | "accueil"
        | "accueil_ophtalmo"
        | "accueil_dermato"
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
      app_role: ["admin", "medecin", "secretaire"],
      demi_journee: ["matin", "apres_midi", "toute_journee"],
      periode: ["matin", "apres_midi"],
      priorite_besoin: ["haute", "moyenne", "basse"],
      source_horaire: ["horaire_base", "bloc_operatoire", "absence"],
      statut_absence: ["en_attente", "approuve", "refuse"],
      statut_horaire: ["disponible", "absent", "bloc_operatoire"],
      statut_planning: ["planifie", "confirme", "absent", "annule"],
      type_absence: ["conges", "maladie", "formation", "autre"],
      type_alternance: [
        "hebdomadaire",
        "une_sur_deux",
        "une_sur_trois",
        "une_sur_quatre",
      ],
      type_besoin: ["medecin", "bloc_operatoire"],
      type_besoin_personnel: [
        "anesthesiste",
        "instrumentiste",
        "instrumentiste_aide_salle",
        "aide_salle",
        "accueil",
        "accueil_ophtalmo",
        "accueil_dermato",
      ],
      type_horaire: ["fixe", "disponible"],
      type_personne: ["medecin", "secretaire"],
      type_planning: ["medecin", "secretaire"],
      user_role: ["admin", "medecin", "secretaire"],
    },
  },
} as const
