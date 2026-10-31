CREATE TABLE "ai_request_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"attempts" integer NOT NULL,
	"success" boolean NOT NULL,
	"error_code" text,
	"input_chars" integer NOT NULL,
	"output_chars" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"type" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"note" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"blueprint_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assessment_blueprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer,
	"title" text NOT NULL,
	"skill_slugs" jsonb NOT NULL,
	"target_level" integer NOT NULL,
	"items" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"learning_plan_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"skill_id" integer NOT NULL,
	"type" text NOT NULL,
	"difficulty" integer NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"correct_index" integer,
	"explanation" text DEFAULT '' NOT NULL,
	"rubric" jsonb
);
--> statement-breakpoint
CREATE TABLE "career_families" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"current_role_slug" text,
	"years_experience" double precision,
	"location" text DEFAULT '' NOT NULL,
	"markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"salary_min" integer,
	"salary_currency" text,
	"weekly_learning_hours" double precision,
	"study_days_per_week" integer DEFAULT 5 NOT NULL,
	"deadline" text,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"learning_style" text,
	"monthly_budget" integer,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_affinity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"work_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_role_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"family_id" integer NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"purpose" text NOT NULL,
	"details" jsonb NOT NULL,
	"task_profile" jsonb NOT NULL,
	"work_values" jsonb NOT NULL,
	"min_years" jsonb NOT NULL,
	"title_keywords" jsonb NOT NULL,
	"cert_trends_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_role_id" integer NOT NULL,
	"to_role_id" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"typical_months" integer NOT NULL,
	"transferable_skills" jsonb NOT NULL,
	"rationale" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"attempt_id" integer NOT NULL,
	"score" double precision NOT NULL,
	"passed" boolean NOT NULL,
	"per_item" jsonb NOT NULL,
	"per_skill" jsonb NOT NULL,
	"feedback" text NOT NULL,
	"uncertainties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"speaker" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"topic_key" text,
	"difficulty" integer,
	"rubric" jsonb,
	"ideal_points" jsonb,
	"evaluation" jsonb,
	"input_mode" text,
	"generated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"overall_score" double precision NOT NULL,
	"rubric_breakdown" jsonb NOT NULL,
	"strengths" jsonb NOT NULL,
	"weaknesses" jsonb NOT NULL,
	"question_feedback" jsonb NOT NULL,
	"improvements" jsonb NOT NULL,
	"learning_tasks" jsonb NOT NULL,
	"comparison" jsonb,
	"profile_suggestions" jsonb,
	"caveats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"scheduled_at" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"practice_session_id" integer
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mode" text NOT NULL,
	"role_id" integer,
	"job_id" integer,
	"seniority" text DEFAULT 'middle' NOT NULL,
	"round_type" text DEFAULT 'mixed' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"duration_minutes" integer DEFAULT 20 NOT NULL,
	"answer_mode" text DEFAULT 'text' NOT NULL,
	"focus_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"blueprint" jsonb NOT NULL,
	"current_difficulty" integer DEFAULT 3 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"job_id" integer,
	"resume_version_id" integer,
	"stage" text DEFAULT 'saved' NOT NULL,
	"outcome" text,
	"applied_at" timestamp with time zone,
	"source" text DEFAULT '' NOT NULL,
	"job_snapshot" jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"follow_up_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"base_url" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"complete_listing" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_message" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"owner_user_id" integer,
	"canonical_url" text,
	"origin_site" text,
	"title" text NOT NULL,
	"normalized_role_id" integer,
	"company" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"required_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unknown_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qualifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_years" double precision,
	"seniority" text,
	"location" text,
	"country" text,
	"market" text,
	"work_mode" text,
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"posted_at" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"dedup_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"parsed_by" text,
	"duplicate_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"weekly_hours" double precision NOT NULL,
	"study_days_per_week" integer DEFAULT 5 NOT NULL,
	"start_date" text NOT NULL,
	"deadline" text,
	"projected_end_date" text NOT NULL,
	"total_hours" double precision NOT NULL,
	"feasible" boolean NOT NULL,
	"feasibility_note" text NOT NULL,
	"skipped_node_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra_skill_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill_id" integer,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"free" boolean DEFAULT true NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"estimated_hours" double precision
);
--> statement-breakpoint
CREATE TABLE "learning_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"milestone_id" integer,
	"node_key" text NOT NULL,
	"skill_slug" text,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"week_index" integer NOT NULL,
	"scheduled_date" text,
	"estimated_hours" double precision NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"resource_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"origin" text NOT NULL,
	"period" text NOT NULL,
	"role_key" text NOT NULL,
	"market" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"collected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"title" text NOT NULL,
	"target_date" text NOT NULL,
	"node_keys" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"reason" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"start_date" text,
	"end_date" text,
	"description" text DEFAULT '' NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"confirmed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"bullet_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"resume_id" integer NOT NULL,
	"version_no" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"quality" jsonb,
	"created_by" text NOT NULL,
	"generated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"job_id" integer,
	"base_resume_id" integer,
	"template" text DEFAULT 'classic' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"current_version_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"roadmap_id" integer NOT NULL,
	"from_key" text NOT NULL,
	"to_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"roadmap_id" integer NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"group_key" text,
	"skill_id" integer,
	"description" text DEFAULT '' NOT NULL,
	"learning_outcome" text DEFAULT '' NOT NULL,
	"estimated_hours" double precision DEFAULT 0 NOT NULL,
	"practice_task" text DEFAULT '' NOT NULL,
	"verification_method" text DEFAULT '' NOT NULL,
	"resource_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"x" double precision DEFAULT 0 NOT NULL,
	"y" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"curated" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_skill_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"weight" double precision NOT NULL,
	"required_level" integer NOT NULL,
	"critical" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"type" text NOT NULL,
	"score" double precision,
	"observed_level" double precision,
	"grading_method" text,
	"source_ref" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prerequisites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_hours" double precision NOT NULL,
	"learning_outcome" text NOT NULL,
	"practice_task" text NOT NULL,
	"framework_refs" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"status" text NOT NULL,
	"proficiency" double precision,
	"self_rating" integer,
	"confidence" double precision DEFAULT 0.3 NOT NULL,
	"status_reason" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_blueprint_id_assessment_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."assessment_blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_blueprints" ADD CONSTRAINT "assessment_blueprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_blueprints" ADD CONSTRAINT "assessment_blueprints_role_id_career_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."career_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_roles" ADD CONSTRAINT "career_roles_family_id_career_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."career_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_transitions" ADD CONSTRAINT "career_transitions_from_role_id_career_roles_id_fk" FOREIGN KEY ("from_role_id") REFERENCES "public"."career_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_transitions" ADD CONSTRAINT "career_transitions_to_role_id_career_roles_id_fk" FOREIGN KEY ("to_role_id") REFERENCES "public"."career_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_messages" ADD CONSTRAINT "interview_messages_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_reports" ADD CONSTRAINT "interview_reports_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_rounds" ADD CONSTRAINT "interview_rounds_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_rounds" ADD CONSTRAINT "interview_rounds_practice_session_id_interview_sessions_id_fk" FOREIGN KEY ("practice_session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_role_id_career_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."career_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_resume_version_id_resume_versions_id_fk" FOREIGN KEY ("resume_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_snapshots" ADD CONSTRAINT "job_snapshots_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_normalized_role_id_career_roles_id_fk" FOREIGN KEY ("normalized_role_id") REFERENCES "public"."career_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_role_id_career_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."career_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_items" ADD CONSTRAINT "profile_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_evidence" ADD CONSTRAINT "resume_evidence_version_id_resume_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."resume_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_edges" ADD CONSTRAINT "roadmap_edges_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_nodes" ADD CONSTRAINT "roadmap_nodes_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_nodes" ADD CONSTRAINT "roadmap_nodes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_role_id_career_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."career_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_skill_requirements" ADD CONSTRAINT "role_skill_requirements_role_id_career_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."career_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_skill_requirements" ADD CONSTRAINT "role_skill_requirements_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_items_key_uq" ON "assessment_items" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "career_families_slug_uq" ON "career_families" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "career_roles_slug_uq" ON "career_roles" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "career_transition_uq" ON "career_transitions" USING btree ("from_role_id","to_role_id");--> statement-breakpoint
CREATE INDEX "interview_messages_session_idx" ON "interview_messages" USING btree ("session_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_report_session_uq" ON "interview_reports" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_key_uq" ON "job_sources" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedup_uq" ON "jobs" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "jobs_role_idx" ON "jobs" USING btree ("normalized_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_obs_uq" ON "market_observations" USING btree ("source_key","origin","period","role_key","market","metric");--> statement-breakpoint
CREATE INDEX "profile_items_user_idx" ON "profile_items" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_version_uq" ON "resume_versions" USING btree ("resume_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmap_node_key_uq" ON "roadmap_nodes" USING btree ("roadmap_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmaps_role_uq" ON "roadmaps" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_skill_uq" ON "role_skill_requirements" USING btree ("role_id","skill_id");--> statement-breakpoint
CREATE INDEX "skill_evidence_user_idx" ON "skill_evidence" USING btree ("user_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_slug_uq" ON "skills" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_skill_uq" ON "user_skills" USING btree ("user_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");