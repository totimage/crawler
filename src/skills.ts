// Canonical-cased skill keywords used to detect skills in resume text and job descriptions.
export const SKILL_DICTIONARY: string[] = [
  // languages
  "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Go", "Golang", "Rust", "Ruby", "PHP", "Swift",
  "Kotlin", "Scala", "MATLAB", "Perl", "Bash", "PowerShell", "SQL", "NoSQL", "HTML", "CSS", "Sass", "Dart",
  "Elixir", "Haskell", "Lua", "Objective-C", "VBA", "Solidity", "Groovy", "COBOL", "Fortran",
  // web / frameworks
  "React", "React Native", "Angular", "Vue", "Vue.js", "Svelte", "Next.js", "Nuxt", "Node.js", "Express", "NestJS",
  "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Rails", "Ruby on Rails", "Laravel", ".NET", "ASP.NET",
  "jQuery", "Redux", "GraphQL", "REST", "REST APIs", "gRPC", "WebSockets", "Tailwind", "Bootstrap", "Webpack", "Vite",
  "Flutter", "SwiftUI", "Android", "iOS", "Electron", "Unity", "Unreal Engine",
  // data / ml
  "Pandas", "NumPy", "SciPy", "scikit-learn", "TensorFlow", "PyTorch", "Keras", "Spark", "PySpark", "Hadoop", "Kafka",
  "Airflow", "dbt", "Snowflake", "Databricks", "BigQuery", "Redshift", "Tableau", "Power BI", "Looker", "Excel",
  "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "LLM", "Generative AI", "Data Analysis",
  "Data Visualization", "Statistics", "A/B Testing", "ETL", "Data Engineering", "Data Science", "Data Modeling",
  "OpenCV", "Hugging Face", "LangChain", "RAG", "MLOps", "Jupyter",
  // databases
  "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Elasticsearch", "DynamoDB", "Cassandra", "Oracle",
  "SQL Server", "Firebase", "Supabase", "Neo4j",
  // cloud / devops
  "AWS", "Azure", "GCP", "Google Cloud", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "GitHub Actions",
  "GitLab CI", "CI/CD", "Linux", "Unix", "Nginx", "Serverless", "Lambda", "EC2", "S3", "CloudFormation", "Helm",
  "Prometheus", "Grafana", "Datadog", "Splunk", "DevOps", "SRE", "Microservices", "Git", "Vercel", "Heroku",
  // security / networking
  "Cybersecurity", "Penetration Testing", "SIEM", "IAM", "OAuth", "Networking", "TCP/IP", "Firewalls", "SOC 2",
  "ISO 27001", "Encryption", "Vulnerability Management",
  // practices / tools
  "Agile", "Scrum", "Kanban", "Jira", "Confluence", "TDD", "Unit Testing", "Selenium", "Cypress", "Playwright",
  "Jest", "Pytest", "System Design", "Distributed Systems", "Object-Oriented Programming", "Design Patterns",
  "API Design", "Performance Optimization", "Figma", "Sketch", "Adobe Photoshop", "Adobe Illustrator",
  "Adobe XD", "InDesign", "UX Design", "UI Design", "User Research", "Wireframing", "Prototyping",
  "Design Systems", "Usability Testing", "Interaction Design", "Information Architecture", "Accessibility", "WCAG",
  "Framer", "Webflow", "Miro", "FigJam", "Storybook", "Design Tokens", "Journey Mapping", "User Flows", "Personas",
  "Motion Design", "After Effects", "Visual Design", "Product Design", "Design Thinking", "Heuristic Evaluation",
  "Hotjar", "Mixpanel", "Amplitude", "Notion", "Asana", "Trello", "Responsive Design", "Mobile Design",
  "Component Libraries", "Developer Handoff", "UX Writing", "Service Design", "Branding", "Typography",
  "Illustration", "3D Modeling", "Blender", "Cinema 4D", "Zeplin", "InVision", "Principle", "ProtoPie",
  "Conversion Optimization", "Data Visualization", "Dashboards", "SaaS", "B2B", "E-commerce", "Fintech", "Healthcare",
  // business / general
  "Project Management", "Product Management", "Program Management", "Stakeholder Management", "Roadmapping",
  "Budgeting", "Forecasting", "Financial Modeling", "Financial Analysis", "Accounting", "Bookkeeping", "QuickBooks",
  "SAP", "Salesforce", "HubSpot", "CRM", "ERP", "Marketing", "Digital Marketing", "SEO", "SEM", "Google Analytics",
  "Content Marketing", "Social Media", "Email Marketing", "Copywriting", "Sales", "Business Development",
  "Account Management", "Customer Success", "Customer Service", "Negotiation", "Lead Generation",
  "Market Research", "Business Analysis", "Operations", "Supply Chain", "Logistics", "Procurement",
  "Inventory Management", "Lean", "Six Sigma", "Process Improvement", "Risk Management", "Compliance",
  "Recruiting", "Talent Acquisition", "Onboarding", "HR", "Payroll", "Training", "Public Speaking",
  "Leadership", "Team Leadership", "Mentoring", "Communication", "Cross-functional Collaboration",
  "Problem Solving", "Strategic Planning", "Data-Driven Decision Making", "Microsoft Office", "Google Workspace",
  "Technical Writing", "Documentation", "Microsoft Word", "PowerPoint", "Outlook", "Google Sheets", "Google Docs", "PMP", "CPA", "Nursing", "Patient Care", "EHR", "Epic", "HIPAA",
  "AutoCAD", "SolidWorks", "CAD", "PLC", "Quality Assurance", "QA", "Manual Testing", "Teaching",
  "Curriculum Development",
];

// Entries that are also ordinary English words: only match with exact casing.
export const CASE_SENSITIVE = new Set([
  "Go", "Swift", "Spring", "Express", "Lean", "Excel", "Rust", "Ruby", "Unity", "Epic", "Lambda", "Sales",
  "Training", "Operations", "Marketing", "Leadership", "Communication", "Teaching", "Oracle", "Flask", "Spark",
  "Vue", "React", "Git", "Agile", "Scrum", "Redux", "Looker", "Sketch", "Lua", "Dart", "REST", "QA", "HR", "Documentation",
  "Accounting", "Budgeting", "Forecasting", "Recruiting", "Onboarding", "Payroll", "Negotiation", "Networking",
  "Statistics", "Compliance", "Logistics", "Procurement", "Mentoring", "Copywriting", "Nursing", "Encryption",
]);

/** Find dictionary skills present in text. */
export function findSkills(text: string, extra: string[] = []): string[] {
  const found = new Map<string, string>();
  const terms = [...SKILL_DICTIONARY, ...extra];
  for (const kw of terms) {
    const key = kw.toLowerCase();
    if (found.has(key) || !kw.trim()) continue;
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = CASE_SENSITIVE.has(kw) ? "" : "i";
    if (new RegExp(`(^|[^A-Za-z0-9+#])${esc}([^A-Za-z0-9+#]|$)`, flags).test(text)) found.set(key, kw);
  }
  return [...found.values()];
}

// Generic soft skills: real, but useless for telling jobs apart.
export const SOFT_SKILLS = new Set(["Communication", "Leadership", "Team Leadership", "Problem Solving", "Mentoring",
  "Cross-functional Collaboration", "Strategic Planning", "Public Speaking", "Training", "Teaching", "Negotiation",
  "Data-Driven Decision Making", "Documentation", "Microsoft Office", "Google Workspace", "Operations"].map((s) => s.toLowerCase()));

const reCache = new Map<string, RegExp>();
/** True if `kw` appears in `text` as a whole term (case-sensitive for ambiguous words like "Go"). */
export function hasSkill(text: string, kw: string): boolean {
  let re = reCache.get(kw);
  if (!re) {
    const e = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^A-Za-z0-9+#])${e}([^A-Za-z0-9+#]|$)`, CASE_SENSITIVE.has(kw) ? "" : "i");
    reCache.set(kw, re);
  }
  return re.test(text);
}
