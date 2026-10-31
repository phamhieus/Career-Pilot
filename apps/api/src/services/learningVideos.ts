/** Publisher-linked series. Keep the source page so learners can inspect the course outline.
 * Playlist URLs checked on 2026-10-31; availability and embedding remain controlled by YouTube/publishers.
 */
export interface LearningVideoSeries {
  id: string; title: string; provider: string; url: string; sourceUrl: string; language: string;
  skillSlugs: string[]; roles: string[];
}

export const LEARNING_VIDEO_SERIES: LearningVideoSeries[] = [
  {
    id: 'cs50-python', title: 'CS50 — Introduction to Programming with Python', provider: 'Harvard / CS50', language: 'English',
    url: 'https://www.youtube.com/playlist?list=PLhQjrBD2T3817j24-GogXmWqO5Q5vYy0V', sourceUrl: 'https://cs50.harvard.edu/python/weeks/',
    skillSlugs: ['python', 'programming-fundamentals', 'testing'], roles: [],
  },
  {
    id: 'cs50-sql', title: 'CS50 — Introduction to Databases with SQL', provider: 'Harvard / CS50', language: 'English',
    url: 'https://www.youtube.com/playlist?list=PLhQjrBD2T382v1MBjNOhPu9SiJ1fsD4C0', sourceUrl: 'https://cs50.harvard.edu/sql/weeks/',
    skillSlugs: ['sql', 'relational-databases'], roles: ['data-analyst', 'database-administrator'],
  },
  {
    id: 'cs50-web', title: 'CS50 — Web Programming with Python and JavaScript', provider: 'Harvard / CS50', language: 'English',
    url: 'https://www.youtube.com/playlist?list=PLhQjrBD2T380xvFSUmToMMzERZ3qB5Ueu', sourceUrl: 'https://cs50.harvard.edu/web/weeks/',
    skillSlugs: ['python', 'javascript', 'html-css', 'web-fundamentals', 'git', 'sql', 'testing', 'ci-cd', 'security-fundamentals'], roles: ['backend-engineer', 'frontend-engineer', 'fullstack-engineer'],
  },
  {
    id: 'cs50-ai', title: 'CS50 — Introduction to Artificial Intelligence with Python', provider: 'Harvard / CS50', language: 'English',
    url: 'https://www.youtube.com/playlist?list=PLhQjrBD2T381PopUTYtMSstgk-hsTGkVm', sourceUrl: 'https://cs50.harvard.edu/ai/weeks/',
    skillSlugs: ['machine-learning', 'deep-learning', 'nlp', 'statistics'], roles: ['ml-engineer', 'data-scientist'],
  },
  {
    id: 'cs50-intro', title: 'CS50 — Introduction to Computer Science', provider: 'Harvard / CS50', language: 'English',
    url: 'https://www.youtube.com/playlist?list=PLhQjrBD2T380hlTqAU8HfvVepCcjCqTg6', sourceUrl: 'https://cs50.harvard.edu/x/weeks/',
    skillSlugs: ['programming-fundamentals', 'data-structures-algorithms', 'python', 'sql', 'html-css', 'javascript'], roles: [],
  },
  {
    id: 'microsoft-genai', title: 'Generative AI for Beginners', provider: 'Microsoft Developer', language: 'English',
    url: 'https://www.youtube.com/playlist?list=PLlrxD0HtieHj2nfK54c62lcs3-YSTx3Je', sourceUrl: 'https://github.com/microsoft/generative-ai-for-beginners',
    skillSlugs: ['llm-applications', 'rag', 'ai-evaluation'], roles: ['ai-engineer'],
  },
  {
    id: 'devops-zero-to-hero', title: 'DevOps Zero to Hero', provider: 'Abhishek Veeramalla', language: 'English',
    url: 'https://www.youtube.com/playlist?list=PLdpzxOOAlwvIKMhk8WhzN1pYoJ1YU8Csa', sourceUrl: 'https://www.youtube.com/@AbhishekVeeramalla',
    skillSlugs: ['linux', 'scripting', 'git', 'ci-cd', 'containers', 'kubernetes', 'iac', 'aws', 'observability'], roles: ['devops-engineer', 'cloud-engineer', 'platform-engineer', 'site-reliability-engineer'],
  },
  {
    id: 'figma-beginners', title: 'Figma for Beginners', provider: 'Figma', language: 'English',
    url: 'https://www.youtube.com/playlist?list=PLXDU_eVOJTx7QHLShNqIXL1Cgbxj7HlN4', sourceUrl: 'https://design.education.gov.uk/design-system/figma',
    skillSlugs: ['figma', 'visual-design', 'wireframing-prototyping', 'interaction-design'], roles: ['ui-designer', 'ux-ui-designer', 'product-designer', 'ux-designer'],
  },
];

/** Exact skill mappings, with a role-specific series first for the full-plan player. */
export function videoSeriesForSkills(skillSlugs: string[], roleSlug?: string) {
  const covered = (s: LearningVideoSeries) => s.skillSlugs.filter((slug) => skillSlugs.includes(slug)).length;
  return LEARNING_VIDEO_SERIES.filter((s) => covered(s) > 0 || !!roleSlug && s.roles.includes(roleSlug))
    .sort((a, b) => Number(!!roleSlug && b.roles.includes(roleSlug)) - Number(!!roleSlug && a.roles.includes(roleSlug)) || covered(b) - covered(a));
}
