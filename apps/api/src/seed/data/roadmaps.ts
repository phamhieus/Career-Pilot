/**
 * Curated roadmaps. Skill nodes are referenced by skill slug (their metadata comes from the skill
 * taxonomy); concept/project/assessment nodes are defined inline. Prerequisite edges are derived
 * from the global skill graph and from each node's `after` list. Original content — inspired by
 * the general idea of visual roadmaps, not copied from any third-party roadmap.
 */
export interface CustomNode {
  key: string;
  type: 'concept' | 'project' | 'assessment';
  label: string;
  description: string;
  hours: number;
  outcome: string;
  practice: string;
  verification: string;
  after: string[];
}
export type NodeSpec = string | CustomNode;
export interface RoadmapSeed {
  role: string;
  title: string;
  description: string;
  groups: { key: string; label: string; nodes: NodeSpec[] }[];
}

const concept = (key: string, label: string, hours: number, after: string[], description: string, practice: string): CustomNode => ({
  key, type: 'concept', label, description, hours, after,
  outcome: description,
  practice,
  verification: 'Covered by the next assessment checkpoint; scenario questions test understanding.',
});
const project = (key: string, label: string, hours: number, after: string[], description: string, deliverable: string): CustomNode => ({
  key, type: 'project', label, description, hours, after,
  outcome: `Deliver a working, documented result: ${deliverable}`,
  practice: deliverable,
  verification: 'Practical submission graded against a rubric (AI rubric grading when configured); counts as practical evidence for linked skills.',
});
const checkpoint = (key: string, label: string, after: string[]): CustomNode => ({
  key, type: 'assessment', label, description: `Assessment checkpoint covering: ${after.join(', ')}.`, hours: 1, after,
  outcome: 'Demonstrate the linked skills under assessment conditions.',
  practice: 'Take the checkpoint assessment in CareerPilot.',
  verification: 'Objective quiz (≥70%) plus a scenario/practical item (≥70%) moves a skill to App-Verified.',
});

export const ROADMAPS: RoadmapSeed[] = [
  {
    role: 'backend-engineer',
    title: 'Backend Engineer Roadmap',
    description: 'From programming foundations to production-grade, scalable services.',
    groups: [
      { key: 'foundations', label: 'Foundations', nodes: ['programming-fundamentals', 'git', 'web-fundamentals', 'data-structures-algorithms'] },
      { key: 'language', label: 'Backend language', nodes: [concept('backend-language', 'Choose one backend language', 50, ['programming-fundamentals'], 'Become productive in one backend ecosystem (Java/Spring, C#/.NET, Go, Node.js or Python): project layout, dependency management, testing tools and frameworks.', 'Rebuild a small CLI tool as an HTTP service in your chosen language.')] },
      { key: 'data', label: 'Data & storage', nodes: ['sql', 'relational-databases', 'nosql', 'caching'] },
      { key: 'apis', label: 'APIs & quality', nodes: ['api-design', 'testing', 'design-patterns', concept('authn-authz', 'Authentication & authorization', 8, ['api-design'], 'Sessions vs tokens, OAuth2/OIDC flows, password storage and role/attribute-based authorization.', 'Add login and role-based authorization to your API and document the flow.'), checkpoint('checkpoint-data-apis', 'Checkpoint: Data & APIs', ['sql', 'api-design'])] },
      { key: 'production', label: 'Production readiness', nodes: ['containers', 'ci-cd', 'observability', project('project-crud-api', 'Project: production-style REST API', 25, ['api-design', 'relational-databases', 'testing', 'authn-authz'], 'A REST API with persistence, validation, auth, tests and structured logging.', 'Ship an API with migrations, tests, auth, OpenAPI docs and a Dockerfile.')] },
      { key: 'scale', label: 'Scale & architecture', nodes: ['message-queues', 'system-design', 'distributed-systems', project('project-event-driven', 'Project: event-driven order service', 25, ['message-queues', 'caching', 'containers'], 'An order workflow split into services communicating through events, with retries and idempotency.', 'Build an order service with a queue, idempotent consumer, retries and dead-letter handling.'), checkpoint('checkpoint-system-design', 'Checkpoint: System design', ['system-design', 'caching'])] },
    ],
  },
  {
    role: 'ai-engineer',
    title: 'AI Engineer Roadmap',
    description: 'From Python and ML foundations to reliable, evaluated LLM features in production.',
    groups: [
      { key: 'foundations', label: 'Foundations', nodes: ['python', 'api-design', 'statistics', 'data-wrangling'] },
      { key: 'ml', label: 'ML fundamentals', nodes: ['machine-learning', concept('transformers-intuition', 'How LLMs work: tokens, context & transformers', 8, ['machine-learning'], 'Tokenization, context windows, attention at an intuitive level, sampling parameters and why models hallucinate.', 'Write a short explainer with experiments showing how temperature and context length change outputs.'), checkpoint('checkpoint-ml', 'Checkpoint: ML fundamentals', ['machine-learning', 'statistics'])] },
      { key: 'llm', label: 'Building with LLMs', nodes: ['llm-applications', concept('structured-output', 'Prompting & structured outputs', 8, ['llm-applications'], 'System prompts, few-shot examples, JSON schema outputs and validation with retries.', 'Build an extractor that returns schema-validated JSON and handles invalid outputs.'), concept('tool-calling', 'Tool / function calling', 6, ['structured-output'], 'Letting models call functions safely: schemas, argument validation and human confirmation for side effects.', 'Implement two tools with argument validation and a confirmation step for writes.'), concept('prompt-injection', 'Prompt injection & data-leak defenses', 6, ['tool-calling'], 'Treating external content as untrusted, isolating instructions, output validation and least-privilege tools.', 'Red-team your tool-using feature with 10 injection attempts and document mitigations.')] },
      { key: 'retrieval', label: 'Retrieval (RAG)', nodes: ['rag', concept('chunking-reranking', 'Chunking, hybrid search & reranking', 8, ['rag'], 'Chunking strategies, hybrid keyword/vector retrieval, reranking and citation grounding.', 'Compare two chunking strategies on a fixed question set and report retrieval recall.')] },
      { key: 'quality', label: 'Evaluation & quality', nodes: ['ai-evaluation', concept('cost-latency', 'Cost, latency & caching for LLM calls', 5, ['llm-applications'], 'Token budgeting, model selection, caching, batching, timeouts and graceful fallbacks.', 'Measure cost and latency of a feature and cut cost by 30% without quality loss.'), checkpoint('checkpoint-llm', 'Checkpoint: LLM applications & RAG', ['llm-applications', 'rag'])] },
      { key: 'production', label: 'Production', nodes: ['testing', 'containers', 'mlops', project('project-rag-service', 'Project: document Q&A with citations', 30, ['rag', 'ai-evaluation', 'chunking-reranking'], 'A RAG service with citations, an evaluation set and monitoring of answer quality.', 'Ship a document Q&A API with citations, a 50-question eval set and a quality report.'), project('project-agentic-feature', 'Project: tool-using assistant with guardrails', 20, ['prompt-injection', 'cost-latency'], 'An assistant that calls tools with validated arguments, confirmation for side effects and injection defenses.', 'Build an assistant with 3 tools, guardrails, timeouts and a red-team report.')] },
    ],
  },
  {
    role: 'cloud-engineer',
    title: 'Cloud Engineer Roadmap',
    description: 'From Linux and networking to secure, automated, cost-aware cloud environments.',
    groups: [
      { key: 'foundations', label: 'Foundations', nodes: ['linux', 'networking', 'scripting', 'cloud-fundamentals'] },
      { key: 'core', label: 'Core cloud services', nodes: ['aws', 'iam', concept('vpc-design', 'Cloud network design (VPC/VNet)', 8, ['networking', 'aws'], 'Subnets, routing, NAT, security groups/NACLs, private endpoints and hybrid connectivity.', 'Design and document a VPC for a three-tier app with private data tier.'), 'cloud-security', checkpoint('checkpoint-cloud-core', 'Checkpoint: Cloud core', ['aws', 'iam', 'networking'])] },
      { key: 'automation', label: 'Automation', nodes: ['iac', 'ci-cd', 'containers', 'kubernetes', checkpoint('checkpoint-automation', 'Checkpoint: Automation', ['iac', 'containers'])] },
      { key: 'operations', label: 'Operations & cost', nodes: ['observability', 'finops', concept('backup-dr', 'Backup & disaster recovery', 6, ['cloud-fundamentals'], 'RPO/RTO, backup strategies, multi-AZ and multi-region patterns.', 'Write a DR plan with RPO/RTO targets and test a restore.')] },
      { key: 'projects', label: 'Projects', nodes: [project('project-landing', 'Project: secure three-tier environment with IaC', 25, ['iac', 'iam', 'vpc-design'], 'A Terraform-provisioned environment with private networking, least-privilege IAM and monitoring.', 'Provision VPC, compute, database and IAM via Terraform with a reviewed plan and teardown.'), project('project-k8s', 'Project: deploy to managed Kubernetes', 20, ['kubernetes', 'ci-cd'], 'A containerized app deployed to managed Kubernetes through a pipeline.', 'Deploy an app to EKS/AKS/GKE via CI with health checks and autoscaling.')] },
    ],
  },
  {
    role: 'devops-engineer',
    title: 'DevOps Engineer Roadmap',
    description: 'Automate delivery and operations: pipelines, containers, infrastructure and observability.',
    groups: [
      { key: 'foundations', label: 'Foundations', nodes: ['linux', 'git', 'scripting', 'networking'] },
      { key: 'delivery', label: 'Build & deliver', nodes: ['testing', 'ci-cd', concept('deployment-strategies', 'Deployment strategies & rollback', 6, ['ci-cd'], 'Blue/green, canary and rolling deployments, feature flags and automated rollback.', 'Implement a canary deployment with an automated rollback condition.'), concept('supply-chain', 'Secrets & supply-chain security', 6, ['ci-cd'], 'Secret management, image signing, dependency scanning and least-privilege pipeline credentials.', 'Add secret scanning, dependency scanning and short-lived credentials to a pipeline.'), checkpoint('checkpoint-delivery', 'Checkpoint: Delivery', ['ci-cd', 'containers'])] },
      { key: 'containers', label: 'Containers & orchestration', nodes: ['containers', 'kubernetes', concept('helm-gitops', 'Helm & GitOps', 10, ['kubernetes'], 'Packaging with Helm and declarative deployments with GitOps controllers like Argo CD or Flux.', 'Manage a two-environment deployment with Helm values and a GitOps controller.')] },
      { key: 'infra', label: 'Infrastructure', nodes: ['cloud-fundamentals', 'iac'] },
      { key: 'ops', label: 'Operate', nodes: ['observability', 'sre-practices', checkpoint('checkpoint-ops', 'Checkpoint: Operations', ['observability', 'kubernetes'])] },
      { key: 'projects', label: 'Projects', nodes: [project('project-pipeline', 'Project: end-to-end delivery pipeline', 20, ['deployment-strategies', 'containers', 'supply-chain'], 'A pipeline that tests, scans, builds and deploys with rollback.', 'Build a pipeline with tests, scans, image build, staged deploys and rollback.'), project('project-gitops', 'Project: GitOps platform with monitoring', 20, ['helm-gitops', 'iac', 'observability'], 'Infrastructure and app deployments managed declaratively with dashboards and alerts.', 'Provision a cluster with IaC, deploy via GitOps and add SLO alerts.')] },
    ],
  },
  {
    role: 'business-analyst',
    title: 'Business Analyst Roadmap',
    description: 'From elicitation to precise, testable requirements and process improvement.',
    groups: [
      { key: 'foundations', label: 'Foundations', nodes: ['communication', 'business-acumen', concept('ba-role', 'The BA role & knowledge areas', 6, [], 'What business analysis covers: strategy, elicitation, requirements lifecycle, solution evaluation; how BAs work in agile and predictive projects.', 'Map the BA activities on a past or sample project to the main knowledge areas.')] },
      { key: 'elicitation', label: 'Elicitation & collaboration', nodes: ['requirements-elicitation', 'stakeholder-management', 'facilitation', checkpoint('checkpoint-elicitation', 'Checkpoint: Elicitation', ['requirements-elicitation', 'stakeholder-management'])] },
      { key: 'analysis', label: 'Analysis & modeling', nodes: ['process-modeling', 'business-rules', 'uml-modeling', 'business-analytics'] },
      { key: 'specification', label: 'Specification', nodes: ['requirements-specification', concept('nfr', 'Non-functional requirements', 4, ['requirements-specification'], 'Specifying performance, security, availability, usability and compliance requirements measurably.', 'Write measurable NFRs for a mobile banking feature.'), concept('traceability', 'Traceability & change control', 4, ['requirements-specification'], 'Linking requirements to goals, designs and tests; impact analysis for changes.', 'Build a traceability matrix and analyze the impact of a change request.'), checkpoint('checkpoint-spec', 'Checkpoint: Specification & rules', ['requirements-specification', 'business-rules'])] },
      { key: 'delivery', label: 'Delivery', nodes: ['agile-scrum', concept('uat', 'UAT planning & support', 5, ['requirements-specification'], 'Planning user acceptance testing, preparing scenarios and managing sign-off.', 'Write a UAT plan with scenarios and exit criteria.'), project('project-ba-case', 'Project: end-to-end BA case (loan origination)', 25, ['process-modeling', 'requirements-specification', 'business-rules', 'nfr'], 'A complete analysis package for a loan-origination improvement.', 'Deliver as-is/to-be BPMN, stakeholder map, user stories with acceptance criteria, decision tables and NFRs.')] },
    ],
  },
  {
    role: 'product-manager',
    title: 'Product Manager Roadmap',
    description: 'Discover the right problems, decide with evidence and lead products to outcomes.',
    groups: [
      { key: 'foundations', label: 'Foundations', nodes: ['communication', 'business-acumen', 'agile-scrum'] },
      { key: 'discovery', label: 'Discovery', nodes: ['user-research', concept('problem-framing', 'Problem framing & jobs-to-be-done', 6, ['user-research'], 'Framing problems as customer jobs and outcomes rather than features.', 'Rewrite three feature requests as problem statements with evidence.'), 'product-discovery', checkpoint('checkpoint-discovery', 'Checkpoint: Discovery', ['product-discovery'])] },
      { key: 'decisions', label: 'Decisions & metrics', nodes: ['business-analytics', 'product-metrics', 'experimentation', 'prioritization', checkpoint('checkpoint-prioritization', 'Checkpoint: Prioritization & metrics', ['prioritization', 'product-metrics'])] },
      { key: 'strategy', label: 'Strategy & alignment', nodes: ['product-strategy', 'stakeholder-management', 'go-to-market', concept('prd-writing', 'Writing PRDs & specs', 6, ['problem-framing'], 'Concise product requirement documents: problem, outcomes, scope, risks, open questions.', 'Write a two-page PRD for a feature you would build.')] },
      { key: 'projects', label: 'Projects', nodes: [project('project-discovery-sprint', 'Project: discovery sprint', 20, ['product-discovery', 'problem-framing'], 'A discovery sprint from interviews to validated opportunity.', 'Interview five users, map opportunities and run two assumption tests.'), project('project-strategy-doc', 'Project: strategy & outcome roadmap', 15, ['product-strategy', 'product-metrics'], 'A product strategy and now/next/later roadmap with metrics.', 'Write a strategy with a metric tree and outcome-based roadmap.')] },
    ],
  },
  {
    role: 'it-project-manager',
    title: 'IT Project Manager Roadmap',
    description: 'Plan, control and lead IT projects through uncertainty and change.',
    groups: [
      { key: 'foundations', label: 'Foundations', nodes: ['communication', concept('pm-lifecycles', 'Predictive, agile & hybrid life cycles', 6, [], 'Choosing a delivery approach based on uncertainty, regulation and stakeholder needs.', 'Recommend a life cycle for three sample projects with justification.'), 'agile-scrum'] },
      { key: 'planning', label: 'Planning', nodes: ['project-planning', 'estimation', 'budget-management', checkpoint('checkpoint-planning', 'Checkpoint: Planning', ['project-planning', 'estimation'])] },
      { key: 'control', label: 'Monitoring & control', nodes: ['risk-management', concept('change-control', 'Change control & scope creep', 5, ['project-planning'], 'Change requests, impact analysis, baselines and preventing uncontrolled scope growth.', 'Process two change requests with impact analysis and a decision record.'), concept('status-reporting', 'Status reporting & governance', 5, ['project-planning'], 'RAG status, steering committees, escalation paths and honest reporting.', 'Write a one-page status report for a project at risk.'), checkpoint('checkpoint-risk', 'Checkpoint: Risk & stakeholders', ['risk-management', 'stakeholder-management'])] },
      { key: 'people', label: 'People & partners', nodes: ['stakeholder-management', 'negotiation', 'facilitation', 'vendor-management'] },
      { key: 'delivery', label: 'Delivery', nodes: ['delivery-management', project('project-plan', 'Project: complete plan for a CRM rollout', 20, ['project-planning', 'risk-management', 'budget-management', 'estimation'], 'A full project management plan.', 'Deliver charter, WBS, schedule, budget, RAID log and communication plan.'), project('project-recovery', 'Project: recover a troubled project', 15, ['change-control', 'negotiation', 'status-reporting'], 'A recovery plan for a late, over-budget project.', 'Diagnose root causes, re-baseline and present a recovery plan to a mock steering committee.')] },
    ],
  },
  {
    role: 'ux-ui-designer',
    title: 'UX/UI Designer Roadmap',
    description: 'From research and flows to accessible, systematic interface design.',
    groups: [
      { key: 'foundations', label: 'Foundations', nodes: [concept('design-process', 'Design process & thinking', 6, [], 'Understand → define → ideate → prototype → test; when to diverge and converge.', 'Document the design process you would use for a small feature.'), 'figma', 'visual-design'] },
      { key: 'research', label: 'Research', nodes: ['user-research', 'research-synthesis', 'usability-testing'] },
      { key: 'structure', label: 'Structure & interaction', nodes: ['information-architecture', 'interaction-design', 'wireframing-prototyping', 'ux-writing', checkpoint('checkpoint-ux', 'Checkpoint: UX', ['interaction-design', 'usability-testing'])] },
      { key: 'visual', label: 'Visual & systems', nodes: ['design-systems', 'accessibility', checkpoint('checkpoint-ui', 'Checkpoint: UI & accessibility', ['visual-design', 'accessibility'])] },
      { key: 'collaboration', label: 'Collaboration', nodes: ['design-critique', concept('handoff', 'Developer handoff & design QA', 4, ['design-systems'], 'Specs, tokens, annotations, and reviewing implementation against design.', 'Prepare a handoff file with annotations and run a design QA review.')] },
      { key: 'projects', label: 'Projects', nodes: [project('project-case-study', 'Project: checkout redesign case study', 30, ['usability-testing', 'wireframing-prototyping', 'visual-design'], 'An end-to-end case study from research to tested high-fidelity design.', 'Publish a case study: research, flows, prototypes, test results and final UI.'), project('project-design-system', 'Project: mini design system', 20, ['design-systems', 'accessibility'], 'A small, accessible design system with tokens and documentation.', 'Create tokens and 8 accessible components with usage guidelines.')] },
    ],
  },
];
