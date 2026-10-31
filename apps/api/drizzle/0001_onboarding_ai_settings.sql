-- Idempotent on purpose: an earlier development build applied part of this change set.
CREATE TABLE IF NOT EXISTS "user_ai_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "career_profiles" ADD COLUMN IF NOT EXISTS "onboarding" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_reports" ADD COLUMN IF NOT EXISTS "coaching" jsonb;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
