import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Shared JSON shapes
// ---------------------------------------------------------------------------

export type SkillStatus = 'self_reported' | 'extracted_claim' | 'assessed' | 'app_verified';
export type EvidenceType =
  | 'self_report'
  | 'cv_extraction'
  | 'quiz'
  | 'scenario'
  | 'practical'
  | 'case_study'
  | 'interview_observation'
  | 'course_completion'
  | 'project';
export type GradingMethod = 'objective' | 'ai_rubric' | 'heuristic_rubric' | 'user';

export interface SourceRef { id: string; title: string; url: string; publisher: string; accessed: string }
export interface OutlookItem { text: string; sourceIds?: string[] }
export interface RoleDetails {
  responsibilities: string[];
  tools: string[];
  competencies: string[];
  levels: { junior: string; middle: string; senior: string };
  collaboration: { roleSlug: string; how: string }[];
  entryBarriers: string;
  transitionsNote: string;
  outlook: { observations: OutlookItem[]; predictions: OutlookItem[]; speculation: OutlookItem[]; aiImpact: string };
  sources: SourceRef[];
  careerPaths: string[];
}

export interface RubricCriterion { criterion: string; weight: number; indicators: string[] }

export interface ResumeBullet {
  id: string;
  text: string;
  evidence: { type: 'profile_item' | 'skill' | 'profile'; id: number }[];
  status: 'supported' | 'needs_confirmation';
  issues?: string[];
  locked?: boolean;
  originalText?: string;
}
export interface ResumeSection {
  id: string;
  type: 'summary' | 'experience' | 'projects' | 'education' | 'certifications' | 'skills';
  title: string;
  locked?: boolean;
  entries: {
    id: string;
    profileItemId?: number;
    heading?: string;
    subheading?: string;
    period?: string;
    bullets: ResumeBullet[];
  }[];
}
export interface ResumeContent {
  header: { name: string; headline: string; email?: string; location?: string; links?: string[] };
  sections: ResumeSection[];
}

// ---------------------------------------------------------------------------
// Identity & profile
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 of the cookie token
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const careerProfiles = pgTable('career_profiles', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  headline: text('headline').notNull().default(''),
  summary: text('summary').notNull().default(''),
  currentRoleSlug: text('current_role_slug'),
  yearsExperience: doublePrecision('years_experience'),
  location: text('location').notNull().default(''),
  markets: jsonb('markets').$type<string[]>().notNull().default([]),
  workModes: jsonb('work_modes').$type<string[]>().notNull().default([]),
  salaryMin: integer('salary_min'),
  salaryCurrency: text('salary_currency'),
  weeklyLearningHours: doublePrecision('weekly_learning_hours'),
  studyDaysPerWeek: integer('study_days_per_week').notNull().default(5),
  deadline: text('deadline'),
  preferredLanguage: text('preferred_language').notNull().default('en'),
  learningStyle: text('learning_style'),
  monthlyBudget: integer('monthly_budget'),
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  taskAffinity: jsonb('task_affinity').$type<Record<string, number>>().notNull().default({}),
  workValues: jsonb('work_values').$type<string[]>().notNull().default([]),
  targetRoleSlugs: jsonb('target_role_slugs').$type<string[]>().notNull().default([]),
  goals: text('goals').notNull().default(''),
  /** Guided onboarding: first time each milestone page was seen, and whether the guide is hidden. */
  onboarding: jsonb('onboarding').$type<{ seen?: Record<string, string>; dismissed?: boolean }>().notNull().default({}),
  updatedAt: updatedAt(),
});

/** Per-user AI provider settings. The API key is encrypted at rest and never returned to clients. */
export const userAiSettings = pgTable('user_ai_settings', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<'openai' | 'deepseek' | 'openai-compatible'>().notNull(),
  model: text('model').notNull(),
  baseUrl: text('base_url').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  keyHint: text('key_hint').notNull(),
  updatedAt: updatedAt(),
});

/** Experience, projects, education and certifications. Every CV bullet points back to one of these. */
export const profileItems = pgTable('profile_items', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'work' | 'project' | 'education' | 'certification'>().notNull(),
  title: text('title').notNull(),
  organization: text('organization').notNull().default(''),
  startDate: text('start_date'),
  endDate: text('end_date'),
  description: text('description').notNull().default(''),
  highlights: jsonb('highlights').$type<string[]>().notNull().default([]),
  skillSlugs: jsonb('skill_slugs').$type<string[]>().notNull().default([]),
  url: text('url'),
  source: text('source').$type<'manual' | 'cv_import' | 'interview'>().notNull().default('manual'),
  confirmed: boolean('confirmed').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index('profile_items_user_idx').on(t.userId)]);

// ---------------------------------------------------------------------------
// Career catalog
// ---------------------------------------------------------------------------

export const careerFamilies = pgTable('career_families', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('career_families_slug_uq').on(t.slug)]);

export const careerRoles = pgTable('career_roles', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  familyId: integer('family_id').notNull().references(() => careerFamilies.id),
  name: text('name').notNull(),
  summary: text('summary').notNull(),
  purpose: text('purpose').notNull(),
  details: jsonb('details').$type<RoleDetails>().notNull(),
  taskProfile: jsonb('task_profile').$type<Record<string, number>>().notNull(),
  workValues: jsonb('work_values').$type<string[]>().notNull(),
  minYears: jsonb('min_years').$type<{ junior: number; middle: number; senior: number }>().notNull(),
  titleKeywords: jsonb('title_keywords').$type<string[]>().notNull(),
  certTrendsRoleIds: jsonb('cert_trends_role_ids').$type<string[]>().notNull().default([]),
}, (t) => [uniqueIndex('career_roles_slug_uq').on(t.slug)]);

export const skills = pgTable('skills', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  prerequisites: jsonb('prerequisites').$type<string[]>().notNull().default([]),
  baseHours: doublePrecision('base_hours').notNull(),
  learningOutcome: text('learning_outcome').notNull(),
  practiceTask: text('practice_task').notNull(),
  frameworkRefs: jsonb('framework_refs').$type<{ framework: string; ref: string }[]>().notNull().default([]),
}, (t) => [uniqueIndex('skills_slug_uq').on(t.slug)]);

/** Configurable role-skill requirement matrix (weights are normalized at runtime). */
export const roleSkillRequirements = pgTable('role_skill_requirements', {
  id: serial('id').primaryKey(),
  roleId: integer('role_id').notNull().references(() => careerRoles.id, { onDelete: 'cascade' }),
  skillId: integer('skill_id').notNull().references(() => skills.id),
  weight: doublePrecision('weight').notNull(),
  requiredLevel: integer('required_level').notNull(), // 1..5 at middle level
  critical: boolean('critical').notNull().default(false),
}, (t) => [uniqueIndex('role_skill_uq').on(t.roleId, t.skillId)]);

export const careerTransitions = pgTable('career_transitions', {
  id: serial('id').primaryKey(),
  fromRoleId: integer('from_role_id').notNull().references(() => careerRoles.id, { onDelete: 'cascade' }),
  toRoleId: integer('to_role_id').notNull().references(() => careerRoles.id, { onDelete: 'cascade' }),
  difficulty: integer('difficulty').notNull(), // 1 (adjacent) .. 5 (major pivot)
  typicalMonths: integer('typical_months').notNull(),
  transferableSkills: jsonb('transferable_skills').$type<string[]>().notNull(),
  rationale: text('rationale').notNull(),
}, (t) => [uniqueIndex('career_transition_uq').on(t.fromRoleId, t.toRoleId)]);

export const roadmaps = pgTable('roadmaps', {
  id: serial('id').primaryKey(),
  roleId: integer('role_id').notNull().references(() => careerRoles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  curated: boolean('curated').notNull().default(true),
  version: integer('version').notNull().default(1),
}, (t) => [uniqueIndex('roadmaps_role_uq').on(t.roleId)]);

export const roadmapNodes = pgTable('roadmap_nodes', {
  id: serial('id').primaryKey(),
  roadmapId: integer('roadmap_id').notNull().references(() => roadmaps.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  type: text('type').$type<'group' | 'skill' | 'concept' | 'project' | 'assessment'>().notNull(),
  label: text('label').notNull(),
  groupKey: text('group_key'),
  skillId: integer('skill_id').references(() => skills.id),
  description: text('description').notNull().default(''),
  learningOutcome: text('learning_outcome').notNull().default(''),
  estimatedHours: doublePrecision('estimated_hours').notNull().default(0),
  practiceTask: text('practice_task').notNull().default(''),
  verificationMethod: text('verification_method').notNull().default(''),
  resourceIds: jsonb('resource_ids').$type<number[]>().notNull().default([]),
  x: doublePrecision('x').notNull().default(0),
  y: doublePrecision('y').notNull().default(0),
}, (t) => [uniqueIndex('roadmap_node_key_uq').on(t.roadmapId, t.key)]);

export const roadmapEdges = pgTable('roadmap_edges', {
  id: serial('id').primaryKey(),
  roadmapId: integer('roadmap_id').notNull().references(() => roadmaps.id, { onDelete: 'cascade' }),
  fromKey: text('from_key').notNull(),
  toKey: text('to_key').notNull(),
});

export const learningResources = pgTable('learning_resources', {
  id: serial('id').primaryKey(),
  skillId: integer('skill_id').references(() => skills.id),
  title: text('title').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(), // docs | course | book | article | guide | standard
  provider: text('provider').notNull(),
  free: boolean('free').notNull().default(true),
  language: text('language').notNull().default('en'),
  estimatedHours: doublePrecision('estimated_hours'),
});

// ---------------------------------------------------------------------------
// Skill evidence
// ---------------------------------------------------------------------------

export const userSkills = pgTable('user_skills', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  skillId: integer('skill_id').notNull().references(() => skills.id),
  status: text('status').$type<SkillStatus>().notNull(),
  proficiency: doublePrecision('proficiency'), // 0..5, null = level unknown
  selfRating: integer('self_rating'),
  confidence: doublePrecision('confidence').notNull().default(0.3),
  statusReason: text('status_reason').notNull().default(''),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('user_skill_uq').on(t.userId, t.skillId)]);

export const skillEvidence = pgTable('skill_evidence', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  skillId: integer('skill_id').notNull().references(() => skills.id),
  type: text('type').$type<EvidenceType>().notNull(),
  score: doublePrecision('score'), // 0..1
  observedLevel: doublePrecision('observed_level'),
  gradingMethod: text('grading_method').$type<GradingMethod>(),
  sourceRef: text('source_ref').notNull(), // e.g. "attempt:12", "profile_item:3", "interview:5"
  notes: text('notes').notNull().default(''),
  createdAt: createdAt(),
}, (t) => [index('skill_evidence_user_idx').on(t.userId, t.skillId)]);

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export const assessmentItems = pgTable('assessment_items', {
  id: serial('id').primaryKey(),
  key: text('key').notNull(),
  skillId: integer('skill_id').notNull().references(() => skills.id),
  type: text('type').$type<'mcq' | 'scenario' | 'practical' | 'case_study'>().notNull(),
  difficulty: integer('difficulty').notNull(),
  prompt: text('prompt').notNull(),
  options: jsonb('options').$type<string[]>(),
  correctIndex: integer('correct_index'),
  explanation: text('explanation').notNull().default(''),
  rubric: jsonb('rubric').$type<RubricCriterion[]>(),
}, (t) => [uniqueIndex('assessment_items_key_uq').on(t.key)]);

export interface BlueprintItem { itemId: number; skillSlug: string; type: string; difficulty: number }
export const assessmentBlueprints = pgTable('assessment_blueprints', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').references(() => careerRoles.id),
  title: text('title').notNull(),
  skillSlugs: jsonb('skill_slugs').$type<string[]>().notNull(),
  targetLevel: integer('target_level').notNull(),
  items: jsonb('items').$type<BlueprintItem[]>().notNull(),
  rationale: text('rationale').notNull(),
  learningPlanId: integer('learning_plan_id'),
  createdAt: createdAt(),
});

export const assessmentAttempts = pgTable('assessment_attempts', {
  id: serial('id').primaryKey(),
  blueprintId: integer('blueprint_id').notNull().references(() => assessmentBlueprints.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').$type<'in_progress' | 'graded'>().notNull().default('in_progress'),
  answers: jsonb('answers').$type<Record<string, { choice?: number; text?: string }>>().notNull().default({}),
  startedAt: createdAt(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
});

export interface ItemEvaluation {
  itemId: number;
  skillSlug: string;
  type: string;
  score: number;
  correct?: boolean;
  method: GradingMethod;
  feedback: string;
  criteria?: { criterion: string; score: number; comment: string }[];
}
export const evaluations = pgTable('evaluations', {
  id: serial('id').primaryKey(),
  attemptId: integer('attempt_id').notNull().references(() => assessmentAttempts.id, { onDelete: 'cascade' }),
  score: doublePrecision('score').notNull(),
  passed: boolean('passed').notNull(),
  perItem: jsonb('per_item').$type<ItemEvaluation[]>().notNull(),
  perSkill: jsonb('per_skill').$type<{ skillSlug: string; score: number; passed: boolean; newStatus: SkillStatus; observedLevel: number }[]>().notNull(),
  feedback: text('feedback').notNull(),
  uncertainties: jsonb('uncertainties').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

export interface InterviewTopic {
  key: string;
  label: string;
  kind: 'skill' | 'behavioral' | 'case' | 'system_design' | 'leadership' | 'discovery';
  skillSlug?: string;
  priority: number;
  reason: string;
  covered: boolean;
  followUps: number;
}
export interface InterviewBlueprint {
  topics: InterviewTopic[];
  maxMainQuestions: number;
  maxFollowUpsPerTopic: number;
  context: { roleName: string; jobTitle?: string; jdSkills?: string[]; gaps?: string[]; background?: DiscoveryBackground };
}
/** Starting point a person gives before a discovery questionnaire. */
export interface DiscoveryBackground {
  situation: 'student' | 'tech' | 'non_tech' | 'break';
  currentRoleSlug?: string | null;
  currentTitle?: string;
  yearsExperience?: number | null;
  education?: string;
  summary?: string;
}
export interface AnswerEvaluation {
  score: number; // 0..1
  criteria: { criterion: string; score: number; comment: string }[];
  strengths: string[];
  gaps: string[];
  evidenceQuotes: string[];
  needsFollowUp: boolean;
  followUpFocus?: string;
  method: GradingMethod;
}
/** Multiple-choice options attached to a question (discovery). */
export interface QuestionOptions {
  maxSelect: number;
  choices: { key: string; label: string }[];
}

export const interviewSessions = pgTable('interview_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode').$type<'discovery' | 'skill_verification' | 'job_specific' | 'focused'>().notNull(),
  roleId: integer('role_id').references(() => careerRoles.id),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  seniority: text('seniority').notNull().default('middle'),
  roundType: text('round_type').notNull().default('mixed'),
  language: text('language').notNull().default('en'),
  durationMinutes: integer('duration_minutes').notNull().default(20),
  answerMode: text('answer_mode').$type<'text' | 'voice'>().notNull().default('text'),
  focusSkills: jsonb('focus_skills').$type<string[]>().notNull().default([]),
  status: text('status').$type<'planned' | 'in_progress' | 'completed' | 'abandoned'>().notNull().default('planned'),
  blueprint: jsonb('blueprint').$type<InterviewBlueprint>().notNull(),
  currentDifficulty: integer('current_difficulty').notNull().default(3),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const interviewMessages = pgTable('interview_messages', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull().references(() => interviewSessions.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  speaker: text('speaker').$type<'interviewer' | 'candidate'>().notNull(),
  kind: text('kind').$type<'question' | 'follow_up' | 'answer' | 'closing'>().notNull(),
  content: text('content').notNull(),
  topicKey: text('topic_key'),
  difficulty: integer('difficulty'),
  rubric: jsonb('rubric').$type<RubricCriterion[]>(),
  idealPoints: jsonb('ideal_points').$type<string[]>(),
  evaluation: jsonb('evaluation').$type<AnswerEvaluation>(),
  options: jsonb('options').$type<QuestionOptions>(),
  choices: jsonb('choices').$type<string[]>(),
  inputMode: text('input_mode').$type<'text' | 'voice'>(),
  generatedBy: text('generated_by'),
  createdAt: createdAt(),
}, (t) => [index('interview_messages_session_idx').on(t.sessionId, t.seq)]);

export const interviewReports = pgTable('interview_reports', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull().references(() => interviewSessions.id, { onDelete: 'cascade' }),
  overallScore: doublePrecision('overall_score').notNull(),
  rubricBreakdown: jsonb('rubric_breakdown').$type<{ criterion: string; score: number }[]>().notNull(),
  strengths: jsonb('strengths').$type<string[]>().notNull(),
  weaknesses: jsonb('weaknesses').$type<string[]>().notNull(),
  questionFeedback: jsonb('question_feedback').$type<{ question: string; answerExcerpt: string; score: number; feedback: string; quotes: string[]; topic: string }[]>().notNull(),
  improvements: jsonb('improvements').$type<string[]>().notNull(),
  learningTasks: jsonb('learning_tasks').$type<{ skillSlug: string; title: string }[]>().notNull(),
  comparison: jsonb('comparison').$type<{ previousSessionId: number; previousScore: number; delta: number } | null>(),
  profileSuggestions: jsonb('profile_suggestions').$type<Record<string, unknown> | null>(),
  caveats: jsonb('caveats').$type<string[]>().notNull().default([]),
  /** AI coaching (summary, improvements, per-question tips). Never changes the deterministic score. */
  coaching: jsonb('coaching').$type<{ summary: string; improvements: string[]; questionTips: { index: number; tip: string; betterStructure: string }[]; nextFocus: string[]; generatedBy: string } | null>(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('interview_report_session_uq').on(t.sessionId)]);

// ---------------------------------------------------------------------------
// Learning plans
// ---------------------------------------------------------------------------

export const learningPlans = pgTable('learning_plans', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => careerRoles.id),
  title: text('title').notNull(),
  status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
  learningFormat: text('learning_format').$type<'docs' | 'project' | 'youtube'>().notNull().default('docs'),
  weeklyHours: doublePrecision('weekly_hours').notNull(),
  studyDaysPerWeek: integer('study_days_per_week').notNull().default(5),
  startDate: text('start_date').notNull(),
  deadline: text('deadline'),
  projectedEndDate: text('projected_end_date').notNull(),
  totalHours: doublePrecision('total_hours').notNull(),
  feasible: boolean('feasible').notNull(),
  feasibilityNote: text('feasibility_note').notNull(),
  skippedNodeKeys: jsonb('skipped_node_keys').$type<string[]>().notNull().default([]),
  extraSkillSlugs: jsonb('extra_skill_slugs').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const milestones = pgTable('milestones', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id').notNull().references(() => learningPlans.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  title: text('title').notNull(),
  targetDate: text('target_date').notNull(),
  nodeKeys: jsonb('node_keys').$type<string[]>().notNull(),
  status: text('status').$type<'pending' | 'done'>().notNull().default('pending'),
});

export const learningTasks = pgTable('learning_tasks', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id').notNull().references(() => learningPlans.id, { onDelete: 'cascade' }),
  milestoneId: integer('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
  nodeKey: text('node_key').notNull(),
  skillSlug: text('skill_slug'),
  title: text('title').notNull(),
  detail: text('detail').notNull().default(''),
  type: text('type').$type<'learn' | 'practice' | 'assessment' | 'remedial' | 'project'>().notNull(),
  weekIndex: integer('week_index').notNull(),
  scheduledDate: text('scheduled_date'), // only set for the near-term horizon
  estimatedHours: doublePrecision('estimated_hours').notNull(),
  status: text('status').$type<'todo' | 'done' | 'missed' | 'skipped'>().notNull().default('todo'),
  resourceIds: jsonb('resource_ids').$type<number[]>().notNull().default([]),
  sortOrder: integer('sort_order').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const planRevisions = pgTable('plan_revisions', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id').notNull().references(() => learningPlans.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  summary: text('summary').notNull(),
  changes: jsonb('changes').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Jobs & market
// ---------------------------------------------------------------------------

export const jobSources = pgTable('job_sources', {
  id: serial('id').primaryKey(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  type: text('type').$type<'cert_trends' | 'greenhouse' | 'lever' | 'manual' | 'demo'>().notNull(),
  baseUrl: text('base_url'),
  isDemo: boolean('is_demo').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  completeListing: boolean('complete_listing').notNull().default(false),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncStatus: text('last_sync_status'),
  lastSyncMessage: text('last_sync_message'),
}, (t) => [uniqueIndex('job_sources_key_uq').on(t.key)]);

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id').notNull().references(() => jobSources.id),
  externalId: text('external_id').notNull(),
  ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'cascade' }), // set for private manual imports
  canonicalUrl: text('canonical_url'),
  originSite: text('origin_site'),
  title: text('title').notNull(),
  normalizedRoleId: integer('normalized_role_id').references(() => careerRoles.id),
  company: text('company').notNull(),
  description: text('description').notNull().default(''),
  requiredSkills: jsonb('required_skills').$type<string[]>().notNull().default([]),
  preferredSkills: jsonb('preferred_skills').$type<string[]>().notNull().default([]),
  unknownRequirements: jsonb('unknown_requirements').$type<string[]>().notNull().default([]),
  qualifications: jsonb('qualifications').$type<string[]>().notNull().default([]),
  certifications: jsonb('certifications').$type<{ id: string; name?: string; requirement: 'required' | 'preferred' | 'mentioned' }[]>().notNull().default([]),
  minYears: doublePrecision('min_years'),
  seniority: text('seniority'),
  location: text('location'),
  country: text('country'),
  market: text('market'),
  workMode: text('work_mode'),
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: text('salary_currency'),
  postedAt: text('posted_at'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').$type<'active' | 'closed' | 'unknown'>().notNull().default('active'),
  isDemo: boolean('is_demo').notNull().default(false),
  dedupKey: text('dedup_key').notNull(),
  contentHash: text('content_hash').notNull(),
  parsedBy: text('parsed_by'),
  duplicateCount: integer('duplicate_count').notNull().default(0),
}, (t) => [
  uniqueIndex('jobs_dedup_uq').on(t.dedupKey),
  index('jobs_role_idx').on(t.normalizedRoleId),
]);

export const jobSnapshots = pgTable('job_snapshots', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  capturedAt: createdAt(),
  contentHash: text('content_hash').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  raw: jsonb('raw').$type<unknown>(),
});

export const marketObservations = pgTable('market_observations', {
  id: serial('id').primaryKey(),
  sourceKey: text('source_key').notNull(),
  origin: text('origin').notNull(), // upstream site name
  period: text('period').notNull(), // YYYY-MM
  roleKey: text('role_key').notNull(),
  market: text('market').notNull(),
  metric: text('metric').notNull(), // postings | with_certification | scanned
  value: doublePrecision('value').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('market_obs_uq').on(t.sourceKey, t.origin, t.period, t.roleKey, t.market, t.metric)]);

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

export const resumes = pgTable('resumes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind').$type<'master' | 'tailored'>().notNull(),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  baseResumeId: integer('base_resume_id'),
  template: text('template').notNull().default('classic'),
  language: text('language').$type<'en' | 'vi'>().notNull().default('en'),
  currentVersionId: integer('current_version_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export interface ResumeQuality {
  jdRelevance: { score: number | null; matched: string[]; missing: string[]; note: string };
  clarity: { score: number; issues: string[] };
  completeness: { score: number; missingSections: string[] };
  formatCompatibility: { score: number; notes: string[] };
  evidenceCoverage: { score: number; supported: number; total: number };
  unverifiedClaims: { bulletId: string; text: string; issues: string[] }[];
  disclaimer: string;
}

export const resumeVersions = pgTable('resume_versions', {
  id: serial('id').primaryKey(),
  resumeId: integer('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  versionNo: integer('version_no').notNull(),
  note: text('note').notNull().default(''),
  content: jsonb('content').$type<ResumeContent>().notNull(),
  quality: jsonb('quality').$type<ResumeQuality>(),
  createdBy: text('created_by').$type<'user' | 'generator'>().notNull(),
  generatedBy: text('generated_by'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('resume_version_uq').on(t.resumeId, t.versionNo)]);

/** Normalized bullet -> source evidence links for every saved version. */
export const resumeEvidence = pgTable('resume_evidence', {
  id: serial('id').primaryKey(),
  versionId: integer('version_id').notNull().references(() => resumeVersions.id, { onDelete: 'cascade' }),
  bulletId: text('bullet_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: integer('source_id').notNull(),
});

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export const APPLICATION_STAGES = ['saved', 'applied', 'screening', 'assessment', 'interview', 'offer', 'closed'] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export const APPLICATION_OUTCOMES = ['accepted', 'rejected', 'withdrawn', 'no_response'] as const;
export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

export const jobApplications = pgTable('job_applications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  resumeVersionId: integer('resume_version_id').references(() => resumeVersions.id, { onDelete: 'set null' }),
  stage: text('stage').$type<ApplicationStage>().notNull().default('saved'),
  outcome: text('outcome').$type<ApplicationOutcome>(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  source: text('source').notNull().default(''),
  jobSnapshot: jsonb('job_snapshot').$type<{ title: string; company: string; url: string | null; location: string | null; description: string; requiredSkills: string[]; capturedAt: string; isDemo: boolean }>().notNull(),
  notes: text('notes').notNull().default(''),
  contacts: jsonb('contacts').$type<{ name: string; role?: string; email?: string; note?: string }[]>().notNull().default([]),
  followUpAt: text('follow_up_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const applicationEvents = pgTable('application_events', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id').notNull().references(() => jobApplications.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  fromStage: text('from_stage'),
  toStage: text('to_stage'),
  note: text('note').notNull().default(''),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  at: createdAt(),
});

export const interviewRounds = pgTable('interview_rounds', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id').notNull().references(() => jobApplications.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(), // hr | technical | case | system_design | assessment | leadership | other
  scheduledAt: text('scheduled_at'),
  status: text('status').$type<'scheduled' | 'completed' | 'cancelled'>().notNull().default('scheduled'),
  notes: text('notes').notNull().default(''),
  practiceSessionId: integer('practice_session_id').references(() => interviewSessions.id, { onDelete: 'set null' }),
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Request metadata only - never prompt or completion content. */
export const aiRequestLogs = pgTable('ai_request_logs', {
  id: serial('id').primaryKey(),
  workflow: text('workflow').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  durationMs: integer('duration_ms').notNull(),
  attempts: integer('attempts').notNull(),
  success: boolean('success').notNull(),
  errorCode: text('error_code'),
  inputChars: integer('input_chars').notNull(),
  outputChars: integer('output_chars').notNull(),
  createdAt: createdAt(),
});
