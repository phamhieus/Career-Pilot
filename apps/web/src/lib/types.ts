export interface Dimension { key: 'capability' | 'interest' | 'growth' | 'market'; label: string; score: number | null; coverage: number; confidence: string; explanation: string[] }
export interface RequirementRow {
  skillSlug: string; skillName: string; category: string; weight: number; normalizedWeight: number; requiredLevel: number; critical: boolean;
  state: 'unknown' | 'known'; status: string | null; statusLabel: string | null; level: number | null; levelAssumed: boolean; credit: number | null;
  gate: 'met' | 'claimed' | 'gap' | 'unknown' | null; estimatedGapHours: number;
  trust: number | null; levelFit: number | null; evidenceReason: string;
}
export interface CapabilityBreakdown {
  skillScore: number | null; levelOnlySkillScore: number | null; experienceScore: number | null;
  relevantYears: number | null; typicalYears: number; skillWeight: number; experienceWeight: number;
  skillPoints: number | null; experiencePoints: number | null; evidenceLossPoints: number | null; levelLossPoints: number | null; experienceLossPoints: number | null;
  knownCoverage: number; unknownSkills: number; assumedSkills: number;
  drivers: { skillSlug: string; skillName: string; pointsEarned: number; evidenceLoss: number; levelLoss: number }[];
}
export interface SkillTransfer {
  currentRole: { slug: string; name: string } | null;
  direct: { skillSlug: string; skillName: string; status: string; level: number | null; requiredLevel: number; roleShared: boolean; examples: string[] }[];
  supporting: { skillSlug: string; skillName: string; status: string; level: number | null; supports: string[] }[];
  other: { skillSlug: string; skillName: string; status: string; level: number | null }[];
}
export interface RoleMatch {
  role: { id: number; slug: string; name: string; family: string };
  level: string;
  dimensions: Dimension[];
  criticalGate: { status: 'clear' | 'needs_evidence' | 'blocked'; gaps: string[]; unverified: string[]; message: string };
  requirements: RequirementRow[];
  capabilityBreakdown: CapabilityBreakdown;
  skillTransfer: SkillTransfer;
  transferableFrom: { roleSlug: string; difficulty: number; typicalMonths: number; rationale: string } | null;
  disclaimer: string;
}
export interface MatchSummary { role: { slug: string; name: string; family: string }; dimensions: { key: string; label: string; score: number | null; confidence: string }[]; criticalGate: string; gapCount: number }

export interface SourceRef { id: string; title: string; url: string; publisher: string; accessed: string }
export interface Role {
  id: number; slug: string; name: string; summary: string; purpose: string;
  details: {
    responsibilities: string[]; tools: string[]; competencies: string[]; levels: { junior: string; middle: string; senior: string };
    collaboration: { roleSlug: string; how: string }[]; entryBarriers: string; transitionsNote: string;
    outlook: { observations: { text: string; sourceIds?: string[] }[]; predictions: { text: string; sourceIds?: string[] }[]; speculation: { text: string }[]; aiImpact: string };
    sources: SourceRef[]; careerPaths: string[];
  };
  minYears: { junior: number; middle: number; senior: number };
}

export interface JobListItem {
  id: number; title: string; company: string; location: string | null; market: string | null; workMode: string | null; seniority: string | null; status: string;
  isDemo: boolean; isPrivate: boolean; postedAt: string | null; lastSeenAt: string; url: string | null; originSite: string | null; source?: string;
  role: { slug: string; name: string } | null; requiredSkills: string[]; hasDescription: boolean; certifications: { id: string; name?: string; requirement: string }[]; matchScore: number | null;
}
export interface JobMatchSkill { slug: string; name: string; requirement: 'required' | 'preferred'; requiredLevel: number; status: string | null; statusLabel: string | null; level: number | null; credit: number | null; state: 'matched' | 'partial' | 'gap' | 'unknown' }
export interface JobMatch {
  jobId: number; score: number | null; scoreExplanation: string[]; components: { key: string; label: string; score: number | null; weight: number; detail: string }[];
  evidenceCoverage: number; matchedSkills: JobMatchSkill[]; criticalGaps: { label: string; reason: string }[]; unknownRequirements: { label: string; reason: string }[];
  skills: JobMatchSkill[]; recommendedAssessments: { skillSlug: string; skillName: string; reason: string }[]; roadmapNodes: { roleSlug: string; nodeKey: string; label: string; skillSlug: string }[];
  manualChecks: string[]; jobUrl: string | null; jdAvailable: boolean; disclaimer: string;
}

export interface UserSkill {
  slug: string; name: string; category: string; status: string; statusLabel: string; proficiency: number | null; selfRating: number | null; confidence: number; reason: string;
  evidence: { id: number; type: string; score: number | null; observedLevel: number | null; gradingMethod: string | null; sourceRef: string; notes: string; createdAt: string }[];
}
export interface ProfileItem { id: number; kind: 'work' | 'project' | 'education' | 'certification'; title: string; organization: string; startDate: string | null; endDate: string | null; description: string; highlights: string[]; skillSlugs: string[]; source: string; confirmed: boolean }
export interface Profile {
  headline: string; summary: string; currentRoleSlug: string | null; yearsExperience: number | null; location: string; markets: string[]; workModes: string[];
  salaryMin: number | null; salaryCurrency: string | null; weeklyLearningHours: number | null; studyDaysPerWeek: number; deadline: string | null; preferredLanguage: string;
  learningStyle: string | null; monthlyBudget: number | null; interests: string[]; taskAffinity: Record<string, number>; workValues: string[]; targetRoleSlugs: string[]; goals: string;
}
export interface ProfileResponse { user: { id: number; email: string; displayName: string }; profile: Profile; items: ProfileItem[]; skills: UserSkill[]; completeness: { score: number; checks: { key: string; done: boolean; label: string }[] } }

export interface Task { id: number; planId: number; milestoneId: number | null; nodeKey: string; skillSlug: string | null; title: string; detail: string; type: string; weekIndex: number; scheduledDate: string | null; estimatedHours: number; status: string; resourceIds: number[] }
export interface Resource { id: number; title: string; url: string; type: string; provider: string; free: boolean; estimatedHours: number | null }

export interface ResumeBullet { id: string; text: string; evidence: { type: 'profile_item' | 'skill' | 'profile'; id: number }[]; status?: 'supported' | 'needs_confirmation'; issues?: string[]; locked?: boolean; originalText?: string; userConfirmed?: boolean }
export interface ResumeSection { id: string; type: string; title: string; locked?: boolean; entries: { id: string; profileItemId?: number; heading?: string; subheading?: string; period?: string; bullets: ResumeBullet[] }[] }
export interface ResumeContent { header: { name: string; headline: string; email?: string; location?: string; links?: string[] }; sections: ResumeSection[] }
export interface ResumeQuality {
  jdRelevance: { score: number | null; matched: string[]; missing: string[]; note: string }; clarity: { score: number; issues: string[] }; completeness: { score: number; missingSections: string[] };
  formatCompatibility: { score: number; notes: string[] }; evidenceCoverage: { score: number; supported: number; total: number }; unverifiedClaims: { bulletId: string; text: string; issues: string[] }[]; disclaimer: string;
}

export const STAGES = ['saved', 'applied', 'screening', 'assessment', 'interview', 'offer', 'closed'] as const;
export const OUTCOMES = ['accepted', 'rejected', 'withdrawn', 'no_response'] as const;
