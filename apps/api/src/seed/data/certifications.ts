/**
 * Maps certification ids (as used by the Cert Trends dataset) to the skills a posting that
 * requests them is signalling. Used to derive skill signals for jobs that only expose
 * certification requirements, and to check certification qualifications in job matching.
 */
const SPECIFIC: Record<string, string[]> = {
  'aws-dop': ['aws', 'ci-cd', 'iac'],
  'aws-scs': ['aws', 'cloud-security'],
  'aws-ans': ['aws', 'networking'],
  'aws-mls': ['aws', 'machine-learning'],
  'aws-aif': ['aws', 'llm-applications'],
  'aws-dea': ['aws', 'data-engineering'],
  'aws-dva': ['aws', 'api-design'],
  'az-400': ['azure', 'ci-cd'],
  'az-500': ['azure', 'cloud-security'],
  'az-700': ['azure', 'networking'],
  'az-204': ['azure', 'api-design'],
  'ai-102': ['azure', 'llm-applications'],
  'ai-900': ['azure', 'machine-learning'],
  'dp-100': ['azure', 'machine-learning'],
  'dp-203': ['azure', 'data-engineering'],
  'dp-300': ['azure', 'relational-databases'],
  'dp-900': ['azure', 'sql'],
  'pl-300': ['data-visualization'],
  'gcp-pde': ['gcp', 'data-engineering'],
  'gcp-pcdoe': ['gcp', 'ci-cd', 'sre-practices'],
  'gcp-pmle': ['gcp', 'machine-learning', 'mlops'],
  cks: ['kubernetes', 'cloud-security'],
  'terraform-associate': ['iac'],
  'vault-associate': ['iam'],
  'ocp-java-17': ['java'],
  'oracle-dba-19c': ['relational-databases', 'sql'],
  'mongodb-associate-dev': ['nosql'],
  pcep: ['python'],
  pcap: ['python'],
  'databricks-dea': ['big-data', 'data-engineering'],
  'databricks-mla': ['machine-learning', 'big-data'],
  'snowpro-core': ['data-warehousing'],
  'tableau-desktop-specialist': ['data-visualization'],
  oscp: ['penetration-testing'],
  'pentest-plus': ['penetration-testing'],
  ceh: ['penetration-testing', 'security-fundamentals'],
  'sc-200': ['security-operations', 'incident-response'],
  'cysa-plus': ['security-operations'],
  gcih: ['incident-response'],
  'cyberops-associate': ['security-operations'],
  'sc-300': ['iam'],
  cism: ['grc'],
  cisa: ['grc'],
  ccsp: ['cloud-security'],
  'pmi-acp': ['agile-scrum'],
  'safe-agilist': ['agile-scrum'],
  csm: ['agile-scrum'],
  'psm-1': ['agile-scrum'],
  'psm-2': ['agile-scrum', 'facilitation'],
  'pspo-1': ['prioritization', 'agile-scrum'],
  cspo: ['prioritization', 'agile-scrum'],
  'itil4-foundation': ['delivery-management'],
  'istqb-ctfl-at': ['test-design', 'agile-scrum'],
  'istqb-ct-tae': ['test-automation'],
  'istqb-ct-pt': ['performance-testing'],
  'istqb-ctal-tta': ['test-design', 'test-automation'],
  'istqb-ctal-tm': ['qa-process'],
  'tosca-as1': ['test-automation'],
  'iiba-aac': ['requirements-specification', 'agile-scrum'],
  'iiba-cbda': ['business-analytics'],
  'iiba-cpoa': ['prioritization'],
};

const BY_CATEGORY: Record<string, string[]> = {
  Cloud: ['cloud-fundamentals'],
  DevOps: ['ci-cd', 'linux'],
  Kubernetes: ['kubernetes'],
  Networking: ['networking'],
  Cybersecurity: ['security-fundamentals'],
  Data: ['data-engineering'],
  AI: ['machine-learning'],
  Database: ['relational-databases'],
  'Project Management': ['project-planning', 'risk-management'],
  'Business Analysis': ['requirements-elicitation', 'requirements-specification'],
  Testing: ['test-design'],
  'Software Development': ['programming-fundamentals'],
};

const PREFIX: [RegExp, string][] = [[/^aws-/, 'aws'], [/^az-/, 'azure'], [/^gcp-/, 'gcp'], [/^(rhcsa|rhce|lfcs|linux-plus)$/, 'linux'], [/^(cka|ckad|kcna)$/, 'kubernetes'], [/^(cissp|security-plus|isc2-cc|gsec|securityx|sc-900)$/, 'security-fundamentals']];

export function certificationSkills(id: string, category?: string): string[] {
  if (SPECIFIC[id]) return SPECIFIC[id];
  const fromPrefix = PREFIX.filter(([re]) => re.test(id)).map(([, s]) => s);
  if (fromPrefix.length) return fromPrefix;
  return (category && BY_CATEGORY[category]) || [];
}
