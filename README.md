# omniscope-apps
## Collections of apps built on top of Omniscope APIs and documentation

Apart from being a complete BI data analytics tool, Omniscope is also an integration and extensible platform. 

A family of REST, JavaScript, Python and R APIs lets you:
- Trigger and parameterise workflows
- Schedule and orchestrate complex tasks
- Create projects programmatically from templates with parameters
- Query and transform report data
- Build your own custom data routine or visual components and mini-apps inside Omniscope

All APIs are documented and can be explored here: https://public.omniscope.me/_global_/api/

### Projects

- [`omniscope-workflow-mcp`](./omniscope-workflow-mcp) – A TypeScript MCP server that wraps the **Omniscope Workflow REST API** and exposes workflow execution and parameter management tools to OpenAI-compliant agents.
- [`omniscope-project-creator`](./omniscope-project-creator) – A lightweight demonstration application showing how to build projects dynamically using the **Omniscope Project REST API**, including file upload, embedding, and automatic project creation.
- [`simple-table-with-filters`](./simple-table-with-filters) – A self contained example that showing how to create an application using the **Omniscope Query REST API**. A webpage that queries and renders a data table on the left with a filter panel on the right.
- [`omniscope-scheduler-task-runner`](./omniscope-scheduler-task-runner) – A lightweight demonstration application showing how to execute and monitor Scheduler tasks using the **Omniscope Scheduler REST API**, including live job status polling and job cancellation.
- [`omniscope-workflow-runner`](./omniscope-workflow-runner) – An application showing how to load and update project parameters, execute workflows, and monitor live job status using the **Omniscope Workflow REST API**.
- [`omniscope-lambda-workflow-runner`](./omniscope-lambda-workflow-runner) – An application showing how to trigger ad-hoc lambda workflow executions using the **Omniscope Workflow REST API**, including parameter updates, selective block execution, and real-time job state polling.

