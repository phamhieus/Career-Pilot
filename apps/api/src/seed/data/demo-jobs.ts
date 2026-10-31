/**
 * DEMO job postings — fictional companies, written for demonstrating the matching flow.
 * They are stored with is_demo = true and are always labeled "Demo" in the UI.
 * No salary is given because none would be real.
 */
export interface DemoJob {
  externalId: string;
  title: string;
  company: string;
  location: string;
  country: string;
  market: string;
  workMode: 'remote' | 'hybrid' | 'onsite';
  postedDaysAgo: number;
  description: string;
}

export const DEMO_JOBS: DemoJob[] = [
  {
    externalId: 'demo-ai-engineer-1',
    title: 'AI Engineer (LLM Applications)',
    company: 'Lotus Analytics (Demo)',
    location: 'Ho Chi Minh City',
    country: 'VN',
    market: 'vietnam',
    workMode: 'hybrid',
    postedDaysAgo: 6,
    description: `About the role
We are building AI features for our B2B analytics platform and are looking for an AI Engineer to design, ship and evaluate LLM-powered capabilities.

What you will do
- Build LLM features with structured outputs and tool calling using Python and FastAPI
- Design retrieval-augmented generation (RAG) pipelines with embeddings and a vector database (pgvector)
- Create evaluation sets and monitor quality, latency and cost
- Implement guardrails against prompt injection and data leakage
- Deploy services with Docker on AWS

Requirements
- 2+ years of professional software development experience
- Strong Python and REST API design skills
- Hands-on experience with LLM APIs (OpenAI, DeepSeek or similar)
- Experience building RAG systems
- Solid understanding of machine learning fundamentals and evaluation
- Good communication skills in English

Nice to have
- Experience with Kubernetes
- MLOps experience (model serving, monitoring)
- Statistics background`,
  },
  {
    externalId: 'demo-cloud-engineer-1',
    title: 'Cloud Engineer (AWS)',
    company: 'Harbor Logistics Tech (Demo)',
    location: 'Singapore',
    country: 'SG',
    market: 'singapore',
    workMode: 'hybrid',
    postedDaysAgo: 12,
    description: `Responsibilities
- Provision and manage AWS infrastructure using Terraform
- Design VPC networking, IAM roles and security controls following least privilege
- Containerize workloads with Docker and operate them on EKS
- Build CI/CD pipelines with GitHub Actions
- Set up monitoring and alerting with CloudWatch and Prometheus
- Optimize cloud costs

Requirements
- 3+ years in cloud or infrastructure engineering
- Strong AWS experience (EC2, VPC, IAM, RDS, S3)
- Infrastructure as Code with Terraform (must have)
- Linux administration and Bash scripting
- Solid networking fundamentals (DNS, subnets, load balancers)
- AWS Certified Solutions Architect – Associate (required)

Preferred
- Kubernetes experience
- Cloud security background`,
  },
  {
    externalId: 'demo-backend-1',
    title: 'Senior Backend Engineer (Java)',
    company: 'Saigon Payments Lab (Demo)',
    location: 'Ho Chi Minh City',
    country: 'VN',
    market: 'vietnam',
    workMode: 'onsite',
    postedDaysAgo: 3,
    description: `We are looking for a Senior Backend Engineer to build payment services.

Requirements
- 5+ years of backend development with Java and Spring Boot
- Strong SQL and PostgreSQL experience, including schema design and indexing
- REST API design and microservices architecture
- Experience with Kafka or RabbitMQ
- Unit and integration testing
- Docker and CI/CD
- System design experience for high-throughput systems

Nice to have
- Redis caching
- Observability with OpenTelemetry
- Fintech domain experience`,
  },
  {
    externalId: 'demo-devops-1',
    title: 'DevOps Engineer',
    company: 'Mekong Cloud Services (Demo)',
    location: 'Remote',
    country: 'VN',
    market: 'remote',
    workMode: 'remote',
    postedDaysAgo: 20,
    description: `What you'll do
- Own CI/CD pipelines (GitLab CI) for 30+ services
- Run Kubernetes clusters with Helm and Argo CD
- Write Terraform modules
- Improve observability with Prometheus and Grafana

Must have
- 3+ years DevOps experience
- Docker, Kubernetes, CI/CD
- Linux and Bash
- Terraform

Nice to have
- CKA certification
- SRE practices (SLOs, incident management)`,
  },
  {
    externalId: 'demo-ba-1',
    title: 'Business Analyst (Banking)',
    company: 'Red River Bank Digital (Demo)',
    location: 'Hanoi',
    country: 'VN',
    market: 'vietnam',
    workMode: 'hybrid',
    postedDaysAgo: 9,
    description: `Responsibilities
- Elicit requirements from business stakeholders through interviews and workshops
- Model as-is and to-be processes in BPMN
- Write user stories with acceptance criteria and maintain traceability
- Analyze business rules and data mappings
- Support UAT

Requirements
- 2+ years as a Business Analyst
- Strong requirements elicitation and documentation skills
- Stakeholder management
- SQL for data analysis
- Agile/Scrum experience

Preferred
- Banking domain knowledge
- UML modeling
- CCBA or similar certification`,
  },
  {
    externalId: 'demo-pm-1',
    title: 'Product Manager — Growth',
    company: 'Bamboo Commerce (Demo)',
    location: 'Ho Chi Minh City',
    country: 'VN',
    market: 'vietnam',
    workMode: 'hybrid',
    postedDaysAgo: 15,
    description: `You will own growth for our e-commerce marketplace.

Requirements
- 3+ years in product management
- Product discovery with users and data
- Prioritization frameworks and roadmap ownership
- Strong product analytics: funnels, retention, A/B testing
- Excellent stakeholder communication

Nice to have
- SQL
- Go-to-market experience`,
  },
  {
    externalId: 'demo-uxui-1',
    title: 'UX/UI Designer',
    company: 'Lantern Health (Demo)',
    location: 'Remote',
    country: 'SG',
    market: 'remote',
    workMode: 'remote',
    postedDaysAgo: 5,
    description: `Responsibilities
- Design user flows, wireframes and high-fidelity UI in Figma
- Run usability testing and iterate
- Maintain our design system
- Ensure WCAG accessibility

Requirements
- 2+ years of product design experience with a portfolio
- Interaction design and visual design skills
- Figma, prototyping
- Usability testing
- Accessibility (WCAG)

Nice to have
- User research
- UX writing`,
  },
  {
    externalId: 'demo-itpm-1',
    title: 'IT Project Manager',
    company: 'Pearl Insurance Systems (Demo)',
    location: 'Hanoi',
    country: 'VN',
    market: 'vietnam',
    workMode: 'onsite',
    postedDaysAgo: 30,
    description: `Lead the delivery of core insurance system upgrades.

Requirements
- 4+ years managing IT projects
- Project planning, scheduling and budget management
- Risk management and RAID logs
- Stakeholder and vendor management
- Agile and waterfall delivery
- PMP certification (required)

Preferred
- Negotiation skills
- Insurance domain experience`,
  },
  {
    externalId: 'demo-data-engineer-1',
    title: 'Data Engineer',
    company: 'Lotus Analytics (Demo)',
    location: 'Ho Chi Minh City',
    country: 'VN',
    market: 'vietnam',
    workMode: 'hybrid',
    postedDaysAgo: 11,
    description: `Requirements
- 2+ years building data pipelines
- Strong SQL and Python
- Airflow and dbt
- Data modeling (star schema)
- Data warehouse experience (BigQuery or Snowflake)

Nice to have
- Spark
- Kafka`,
  },
  {
    externalId: 'demo-ai-engineer-2',
    title: 'Junior AI Engineer',
    company: 'Orchid Edu (Demo)',
    location: 'Remote',
    country: 'VN',
    market: 'remote',
    workMode: 'remote',
    postedDaysAgo: 2,
    description: `Build AI tutoring features.

Requirements
- 1+ year of Python development
- Experience calling LLM APIs and prompt engineering
- Basic RAG with a vector database
- REST APIs

Nice to have
- Evaluation of LLM outputs
- TypeScript and React`,
  },
];
