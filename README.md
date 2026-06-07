# FlowAI 2.0 — AI Operating System for Work

FlowAI is a highly configurable, multi-tenant workspace platform designed for modern teams. It unifies high-density work tracking, collaborative knowledge management, visual automation rules, and grounded AI assistance into a premium desktop operating system.

Inspired by Linear, ClickUp, Notion, and advanced AI copilots, FlowAI 2.0 features a premium visual language, interactive canvas elements, and a grounded RAG (Retrieval-Augmented Generation) pipeline.

---

## Key Features & Capabilities

### 1. Premium Visual Interface & Layout
- **Theme Contrasts**: Sleek dark navigation sidebar + clean light main canvas with layered cards, drop shadows, and subtle purple/green AI accents.
- **Micro-Animations**: Slide-out task drawers, hover-scaling interactive elements, layout transitions, and clean skeleton loaders.
- **Premium Topbar**: Includes global search, keyboard-activated command palette shortcut indicators, workspace selectors, role badges, and a profile dropdown.

### 2. Workspace Onboarding Setup Wizard
- Auto-triggers on first-time workspace access.
- Guides users to choose workspace types (Engineering, Marketing, Customer Support, HR), goals, and templates.
- Auto-generates workflow stages, default priorities, active tasks, and team permissions out-of-the-box.

### 3. High-Density Dashboard Redesign
- **Large Hero panel**: Displays active workspace name, greeting, goal checklist, active tasks, overdue items count, and an interactive CTA to scan with AI.
- **Velocity SVG Sparkline**: Visualizes weekly velocity index with custom gradients.
- **My Work Tabbed Widget**: Displays Assigned, Due Today, Overdue, and Recently Updated work items.
- **Team Activity Timeline**: Timeline feed indicating actor actions, entities, and event timestamps.
- **AI Recommendation Engine**: Pinpoints workflow bottlenecks, overdue risk indicators, and suggests optimizations via a "one-click" action button.
- **Today's Schedule Strip**: Visual hourly timeline displaying scheduled block events (Daily Standup, Redesign Review, Code Refinement Sync).

### 4. Advanced Work Board (Multi-View)
- **View Selectors**: Switch dynamically between **Kanban Board**, **Table view**, **Calendar grid**, and **Timeline Gantt chart**.
- **Rich Task Cards**: Exposes priority, assignee avatar, due dates, label chips, comment/attachment count indicators, and dynamic **AI Delay Risk Scores** (%).
- **Interactive Detail Drawer**: Slide-out overlay providing checklist/subtask creation, file attachments, and a **Status (Stage) transition dropdown selector** to move items across columns.
- **AI Task Summarizer**: A grounded one-click analysis button to synthesize task status and suggest next actions.

### 5. Visual Workflow Builder
- **3-Panel Design**:
  - **Left Panel**: Preset template cards (Support, Hiring, Complaint, Bug Tracking, Approval Flow, Research Review) and categories.
  - **Center Canvas**: Interactive visual flowchart stage nodes connected via arrow vectors, supporting zoom controls and stage positioning adjustments.
  - **Right Panel**: Selected node settings panel for configuring custom stage names, colors, SLA limits, isTerminal state, and auto-actions.
- **AI Canvas Composer**: Sparks "Draft with AI" prompt box to generate visual workflows from natural language text.

### 6. Knowledge Hub & Documents
- **Layout structure**: Left directory sidebar (folders and tags tree), Center document cards grid, and Right preview panel.
- **Compose Upload Panel**: Collapsible tab selectors supporting writing text notes vs. uploading files.
- **Confidence Citations & Semantic Preview**: Displays similarity matching scores and citation snippets for files indexed via vector embeddings.

### 7. Grounded AI Assistant (Grounded Chat & Action Modes)
- **Grounded Chat**: Context pack retrieves active templates, stages, members, automation rules, documents, and tasks, citing sources and displaying confidence score badges (high/med/low).
- **Action Mode**: Previews suggested task creation, status transition changes, or rule additions, with a "review before execute" confirmation block.

### 8. Visual Automations Rules Engine
- **Trigger-Condition-Action blocks**: Flowchart trigger, condition, and action cards mapped with visual connector lines.
- **Admin Toggles & Test Run**: Rule activation toggles, rule test execution buttons, and execution logs history table.

### 9. Analytics Command Center
- **Core KPIs**: Cycle time, completion rate, overdue percentages, productivity scores, and active users counts.
- **Grounded charts**: Cycle-time trends, workload heatmaps per user, weekly completion graphs, and bottleneck bars.
- **Natural-Language Insights**: AI cards detailing overloaded members or slower stages with optimization advice.

### 10. Workspace Settings & Branding
- Customize branding covers, upload company logos, toggle integration webhooks, and manage a complete role-based access control (RBAC) permissions matrix.

---

## Local Development & Setup

### Requirements
- **Node.js**: v24 LTS (or higher)
- **Docker**: For running database, search, and message queue services

### 1. Run Core Services
Copy the environment template and run Docker Compose to download and build all services locally:
```bash
cp .env.example .env
docker compose up --build
```

### 2. Available Endpoints
- **Web App**: `http://localhost:5173`
- **Express API**: `http://localhost:4000/api/health`
- **PostgreSQL**: `localhost:55432`
- **MinIO Console**: `http://localhost:9001`
- **Ollama API**: `http://localhost:11434`

### 3. Load LLM Models (Ollama)
Pull text generation and embedding models before using the AI features:
```bash
docker compose exec ollama ollama pull nomic-embed-text
docker compose exec ollama ollama pull llama3.1:8b
```

---

## Verification & Testing

### Type Safety Checks
Run TypeScript compiler check across workspaces to ensure type safety:
```bash
npm run typecheck
```

### Run Tests (Vitest)
Executes the API integration test suite and frontend unit test cases:
```bash
npm test
```
*(All 26 test suites in API and Web pass cleanly).*
