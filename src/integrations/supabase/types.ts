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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      admin_permissions: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          permission: Database["public"]["Enums"]["admin_permission"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          permission: Database["public"]["Enums"]["admin_permission"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          permission?: Database["public"]["Enums"]["admin_permission"]
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      flashcards: {
        Row: {
          back: string
          choice_index: number | null
          created_at: string
          due_at: string
          ease: number
          front: string
          id: string
          interval_days: number
          lapses: number
          last_grade: number | null
          last_reviewed_at: string | null
          module_id: string | null
          question_id: string | null
          repetitions: number
          suspended: boolean
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          back: string
          choice_index?: number | null
          created_at?: string
          due_at?: string
          ease?: number
          front: string
          id?: string
          interval_days?: number
          lapses?: number
          last_grade?: number | null
          last_reviewed_at?: string | null
          module_id?: string | null
          question_id?: string | null
          repetitions?: number
          suspended?: boolean
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          back?: string
          choice_index?: number | null
          created_at?: string
          due_at?: string
          ease?: number
          front?: string
          id?: string
          interval_days?: number
          lapses?: number
          last_grade?: number | null
          last_reviewed_at?: string | null
          module_id?: string | null
          question_id?: string | null
          repetitions?: number
          suspended?: boolean
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashcards_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flashcards_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      module_contents: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          description: string | null
          file_path: string | null
          folder_id: string | null
          id: string
          kind: Database["public"]["Enums"]["content_type"]
          module_id: string
          quiz: Json | null
          rotation_id: string | null
          session_kind: string | null
          session_number: number | null
          session_title: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_path?: string | null
          folder_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["content_type"]
          module_id: string
          quiz?: Json | null
          rotation_id?: string | null
          session_kind?: string | null
          session_number?: number | null
          session_title?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_path?: string | null
          folder_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["content_type"]
          module_id?: string
          quiz?: Json | null
          rotation_id?: string | null
          session_kind?: string | null
          session_number?: number | null
          session_title?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_contents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "module_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_contents_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_contents_rotation_id_fkey"
            columns: ["rotation_id"]
            isOneToOne: false
            referencedRelation: "module_rotations"
            referencedColumns: ["id"]
          },
        ]
      }
      module_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["content_type"]
          module_id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["content_type"]
          module_id: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["content_type"]
          module_id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_folders_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      module_rotations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          module_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          module_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          module_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_rotations_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          slug: string
          sort_order: number
          title: string
          updated_at: string
          year: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
          year: number
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          account_holder: string
          account_number: string
          created_at: string
          extra: string | null
          id: string
          instructions: string | null
          is_active: boolean
          kind: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_holder: string
          account_number: string
          created_at?: string
          extra?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean
          kind: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_holder?: string
          account_number?: string
          created_at?: string
          extra?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean
          kind?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_requests: {
        Row: {
          amount_dzd: number
          created_at: string
          id: string
          is_bundle: boolean
          method_kind: string
          note: string | null
          proof_path: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          scope: Database["public"]["Enums"]["access_scope"]
          status: string
          transaction_ref: string | null
          updated_at: string
          user_id: string
          year: number | null
        }
        Insert: {
          amount_dzd?: number
          created_at?: string
          id?: string
          is_bundle?: boolean
          method_kind: string
          note?: string | null
          proof_path?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          scope?: Database["public"]["Enums"]["access_scope"]
          status?: string
          transaction_ref?: string | null
          updated_at?: string
          user_id: string
          year?: number | null
        }
        Update: {
          amount_dzd?: number
          created_at?: string
          id?: string
          is_bundle?: boolean
          method_kind?: string
          note?: string | null
          proof_path?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          scope?: Database["public"]["Enums"]["access_scope"]
          status?: string
          transaction_ref?: string | null
          updated_at?: string
          user_id?: string
          year?: number | null
        }
        Relationships: []
      }
      pricing_config: {
        Row: {
          bundle_lessons_on_sale: boolean
          bundle_lessons_price_dzd: number
          bundle_lessons_sale_price_dzd: number | null
          bundle_on_sale: boolean
          bundle_price_dzd: number
          bundle_sale_price_dzd: number | null
          bundle_sessions_on_sale: boolean
          bundle_sessions_price_dzd: number
          bundle_sessions_sale_price_dzd: number | null
          currency: string
          id: number
          updated_at: string
        }
        Insert: {
          bundle_lessons_on_sale?: boolean
          bundle_lessons_price_dzd?: number
          bundle_lessons_sale_price_dzd?: number | null
          bundle_on_sale?: boolean
          bundle_price_dzd?: number
          bundle_sale_price_dzd?: number | null
          bundle_sessions_on_sale?: boolean
          bundle_sessions_price_dzd?: number
          bundle_sessions_sale_price_dzd?: number | null
          currency?: string
          id?: number
          updated_at?: string
        }
        Update: {
          bundle_lessons_on_sale?: boolean
          bundle_lessons_price_dzd?: number
          bundle_lessons_sale_price_dzd?: number | null
          bundle_on_sale?: boolean
          bundle_price_dzd?: number
          bundle_sale_price_dzd?: number | null
          bundle_sessions_on_sale?: boolean
          bundle_sessions_price_dzd?: number
          bundle_sessions_sale_price_dzd?: number | null
          currency?: string
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          current_year: number | null
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          current_year?: number | null
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          current_year?: number | null
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      qcm_sessions: {
        Row: {
          answers: Json
          created_at: string
          duration_seconds: number | null
          filters: Json
          finished_at: string | null
          grades: Json
          id: string
          mode: string
          module_id: string
          module_ids: string[]
          paused_at: string | null
          preset_id: string | null
          question_ids: string[]
          resumed_at: string | null
          rotation_id: string | null
          score: number | null
          session_kind: string | null
          session_number: number | null
          sort_mode: string | null
          started_at: string
          time_limit_seconds: number | null
          title: string | null
          total: number
          types: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          duration_seconds?: number | null
          filters?: Json
          finished_at?: string | null
          grades?: Json
          id?: string
          mode?: string
          module_id: string
          module_ids?: string[]
          paused_at?: string | null
          preset_id?: string | null
          question_ids?: string[]
          resumed_at?: string | null
          rotation_id?: string | null
          score?: number | null
          session_kind?: string | null
          session_number?: number | null
          sort_mode?: string | null
          started_at?: string
          time_limit_seconds?: number | null
          title?: string | null
          total?: number
          types?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          duration_seconds?: number | null
          filters?: Json
          finished_at?: string | null
          grades?: Json
          id?: string
          mode?: string
          module_id?: string
          module_ids?: string[]
          paused_at?: string | null
          preset_id?: string | null
          question_ids?: string[]
          resumed_at?: string | null
          rotation_id?: string | null
          score?: number | null
          session_kind?: string | null
          session_number?: number | null
          sort_mode?: string | null
          started_at?: string
          time_limit_seconds?: number | null
          title?: string | null
          total?: number
          types?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qcm_sessions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qcm_sessions_rotation_id_fkey"
            columns: ["rotation_id"]
            isOneToOne: false
            referencedRelation: "module_rotations"
            referencedColumns: ["id"]
          },
        ]
      }
      question_explanations: {
        Row: {
          body: string
          choice_index: number | null
          created_at: string
          generated_by: string | null
          id: string
          model: string | null
          question_id: string
          updated_at: string
        }
        Insert: {
          body: string
          choice_index?: number | null
          created_at?: string
          generated_by?: string | null
          id?: string
          model?: string | null
          question_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          choice_index?: number | null
          created_at?: string
          generated_by?: string | null
          id?: string
          model?: string | null
          question_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_explanations_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_flags: {
        Row: {
          created_at: string
          id: string
          question_id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          question_id: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          question_id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_flags_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_notes: {
        Row: {
          body: string
          question_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          question_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          question_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_notes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_progress: {
        Row: {
          due_at: string
          ease: number
          interval_days: number
          lapses: number
          last_correct: boolean | null
          last_grade: number | null
          last_reviewed_at: string | null
          question_id: string
          repetitions: number
          updated_at: string
          user_id: string
        }
        Insert: {
          due_at?: string
          ease?: number
          interval_days?: number
          lapses?: number
          last_correct?: boolean | null
          last_grade?: number | null
          last_reviewed_at?: string | null
          question_id: string
          repetitions?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          due_at?: string
          ease?: number
          interval_days?: number
          lapses?: number
          last_correct?: boolean | null
          last_grade?: number | null
          last_reviewed_at?: string | null
          question_id?: string
          repetitions?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_progress_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          question_id: string
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          question_id: string
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          question_id?: string
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_reports_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          choices: Json | null
          correct_indices: number[] | null
          created_at: string
          created_by: string | null
          difficulty: number | null
          exam_source: string | null
          exam_year: number | null
          exam_years: number[]
          explanation: string | null
          folder_id: string | null
          id: string
          media_url: string | null
          model_answer: string | null
          module_id: string
          parent_id: string | null
          polarity: Database["public"]["Enums"]["question_polarity"]
          references_text: string | null
          rotation_id: string | null
          rotation_ids: string[]
          session_kind: string | null
          session_number: number | null
          session_title: string | null
          sort_order: number
          source: string
          stem: string
          type: Database["public"]["Enums"]["question_type"]
          updated_at: string
          year: number
        }
        Insert: {
          choices?: Json | null
          correct_indices?: number[] | null
          created_at?: string
          created_by?: string | null
          difficulty?: number | null
          exam_source?: string | null
          exam_year?: number | null
          exam_years?: number[]
          explanation?: string | null
          folder_id?: string | null
          id?: string
          media_url?: string | null
          model_answer?: string | null
          module_id: string
          parent_id?: string | null
          polarity?: Database["public"]["Enums"]["question_polarity"]
          references_text?: string | null
          rotation_id?: string | null
          rotation_ids?: string[]
          session_kind?: string | null
          session_number?: number | null
          session_title?: string | null
          sort_order?: number
          source?: string
          stem: string
          type: Database["public"]["Enums"]["question_type"]
          updated_at?: string
          year: number
        }
        Update: {
          choices?: Json | null
          correct_indices?: number[] | null
          created_at?: string
          created_by?: string | null
          difficulty?: number | null
          exam_source?: string | null
          exam_year?: number | null
          exam_years?: number[]
          explanation?: string | null
          folder_id?: string | null
          id?: string
          media_url?: string | null
          model_answer?: string | null
          module_id?: string
          parent_id?: string | null
          polarity?: Database["public"]["Enums"]["question_polarity"]
          references_text?: string | null
          rotation_id?: string | null
          rotation_ids?: string[]
          session_kind?: string | null
          session_number?: number | null
          session_title?: string | null
          sort_order?: number
          source?: string
          stem?: string
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "questions_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "module_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_rotation_id_fkey"
            columns: ["rotation_id"]
            isOneToOne: false
            referencedRelation: "module_rotations"
            referencedColumns: ["id"]
          },
        ]
      }
      session_events: {
        Row: {
          created_at: string
          duration_ms: number | null
          event: string
          id: number
          payload: Json | null
          question_id: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          event: string
          id?: number
          payload?: Json | null
          question_id?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          event?: string
          id?: number
          payload?: Json | null
          question_id?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_events_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "qcm_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_presets: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          granted_by: string | null
          id: string
          is_bundle: boolean
          note: string | null
          scope: Database["public"]["Enums"]["access_scope"]
          user_id: string
          year: number | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          is_bundle?: boolean
          note?: string | null
          scope?: Database["public"]["Enums"]["access_scope"]
          user_id: string
          year?: number | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          is_bundle?: boolean
          note?: string | null
          scope?: Database["public"]["Enums"]["access_scope"]
          user_id?: string
          year?: number | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          is_super: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_super?: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_super?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      year_prices: {
        Row: {
          lessons_on_sale: boolean
          lessons_price_dzd: number
          lessons_sale_price_dzd: number | null
          on_sale: boolean
          price_dzd: number
          sale_price_dzd: number | null
          sessions_on_sale: boolean
          sessions_price_dzd: number
          sessions_sale_price_dzd: number | null
          updated_at: string
          year: number
        }
        Insert: {
          lessons_on_sale?: boolean
          lessons_price_dzd?: number
          lessons_sale_price_dzd?: number | null
          on_sale?: boolean
          price_dzd?: number
          sale_price_dzd?: number | null
          sessions_on_sale?: boolean
          sessions_price_dzd?: number
          sessions_sale_price_dzd?: number | null
          updated_at?: string
          year: number
        }
        Update: {
          lessons_on_sale?: boolean
          lessons_price_dzd?: number
          lessons_sale_price_dzd?: number | null
          on_sale?: boolean
          price_dzd?: number
          sale_price_dzd?: number | null
          sessions_on_sale?: boolean
          sessions_price_dzd?: number
          sessions_sale_price_dzd?: number | null
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_payment_request: {
        Args: { _request_id: string }
        Returns: undefined
      }
      claim_admin: { Args: never; Returns: boolean }
      has_permission: {
        Args: {
          _perm: Database["public"]["Enums"]["admin_permission"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      list_active_payment_methods: {
        Args: never
        Returns: {
          account_holder: string
          account_number: string
          extra: string
          id: string
          instructions: string
          kind: string
          label: string
          sort_order: number
        }[]
      }
      list_admins: {
        Args: never
        Returns: {
          email: string
          is_super: boolean
          permissions: string[]
          user_id: string
        }[]
      }
      list_all_users: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          user_id: string
        }[]
      }
      promote_admin: {
        Args: {
          _email: string
          _perms: Database["public"]["Enums"]["admin_permission"][]
        }
        Returns: string
      }
      reject_payment_request: {
        Args: { _reason: string; _request_id: string }
        Returns: undefined
      }
      revoke_admin: { Args: { _user_id: string }; Returns: undefined }
      user_has_module_access: {
        Args: { _module_id: string; _user_id: string }
        Returns: boolean
      }
      user_has_module_scope: {
        Args: {
          _module_id: string
          _scope: Database["public"]["Enums"]["access_scope"]
          _user_id: string
        }
        Returns: boolean
      }
      user_has_year_access: {
        Args: { _user_id: string; _year: number }
        Returns: boolean
      }
      user_has_year_scope: {
        Args: {
          _scope: Database["public"]["Enums"]["access_scope"]
          _user_id: string
          _year: number
        }
        Returns: boolean
      }
    }
    Enums: {
      access_scope: "lessons" | "sessions" | "both"
      admin_permission:
        | "manage_modules"
        | "manage_content"
        | "manage_quiz"
        | "manage_pricing"
        | "manage_access"
        | "manage_payments"
        | "manage_cases"
      app_role: "admin" | "user"
      content_type: "html" | "pdf" | "richtext" | "quiz" | "link"
      question_polarity: "correct" | "incorrect"
      question_type: "qcm" | "qcs" | "qroc" | "cas_clinique"
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
      access_scope: ["lessons", "sessions", "both"],
      admin_permission: [
        "manage_modules",
        "manage_content",
        "manage_quiz",
        "manage_pricing",
        "manage_access",
        "manage_payments",
        "manage_cases",
      ],
      app_role: ["admin", "user"],
      content_type: ["html", "pdf", "richtext", "quiz", "link"],
      question_polarity: ["correct", "incorrect"],
      question_type: ["qcm", "qcs", "qroc", "cas_clinique"],
    },
  },
} as const
