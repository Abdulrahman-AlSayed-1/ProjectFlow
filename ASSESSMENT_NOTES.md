# Assessment Notes

## Architecture Overview

### Application Structure & Major Modules
The project is a TypeScript monorepo using pnpm workspaces and Turborepo, split into two main apps and a shared package:
- `apps/api`: NestJS REST API using Mongoose for MongoDB. It is split into domain modules:
  - `auth`: JWT generation, login, and registration with bcrypt.
  - `users`: User document store and batch lookups (`findManyByIds`).
  - `organizations` & `organization-members`: Organization multi-tenancy and org-level roles (`OWNER`, `ADMIN`, `MEMBER`).
  - `projects` & `project-members`: Projects, project membership, and project-level roles (`PROJECT_MANAGER`, `MEMBER`).
  - `tasks`: Task CRUD, pagination, filtering by status/priority, and status updates.
  - `comments`: Comments thread linked to specific tasks.
  - `common`: Global filters (`AllExceptionsFilter`), auth guards (`JwtAuthGuard`), serialization utilities, and the `@CurrentUser` parameter decorator.
- `apps/web`: Next.js 16 (App Router) frontend with React 19 and Tailwind CSS.
  - Organized by features under `src/features/` (`tasks`, `projects`, `comments`, `auth`), each containing its own API calls, React Query hooks, and UI components.
  - Route handlers live in `src/app/(app)/` for authenticated pages and `src/app/login/` for auth.
- `packages/shared`: Shared TypeScript types and enums (`TaskStatus`, `ProjectRole`, `OrganizationRole`, `TaskDetail`, `TaskSummary`, etc.) used by both `api` and `web`.

### Where Business Logic Lives
- Main business logic lives in NestJS services (`*.service.ts`), keeping controllers thin.
- Project access checks are centralized in `ProjectAccessService` (`assertCanView`, `assertCanManage`). Any check for whether a user can see or modify a project/task goes through here.
- Request validation is handled using `class-validator` decorators on DTOs, enforced globally by the `ValidationPipe` in `main.ts`.
- Document serialization and relationship resolution (like mapping creator IDs to user summaries and counting comments) happen inside private service helpers (e.g. `toSummaries` and `toDetail` in `TasksService`).

### Frontend-Backend Communication & Server State
- The frontend talks to the API via plain `fetch` wrappers inside `features/*/api.ts`. Authenticated requests attach a Bearer JWT token from cookies/local state.
- Server state is managed with **TanStack React Query v5** (`features/*/hooks.ts`). Queries are cached under centralized keys in `lib/query-keys.ts`. When mutations succeed (e.g. creating a task or changing status), the corresponding queries are invalidated to trigger background refetches.
- Local UI state (modal open/closed, form fields) uses standard React `useState` and `react-hook-form` with Zod schemas.

### Authentication & Authorization
- **Authentication**: JWT bearer tokens. Passwords hashed with bcrypt (12 rounds). `JwtAuthGuard` is registered globally as `APP_GUARD` in `AppModule`, so every endpoint requires a valid token by default unless decorated with `@Public()`. The `@CurrentUser('id')` decorator extracts the user ID from the request.
- **Authorization**: Two-tier model combining Organization and Project roles:
  - Org roles: `OWNER`, `ADMIN`, `MEMBER`. Owners and Admins are treated as elevated and automatically have access to all projects in the organization.
  - Project roles: `PROJECT_MANAGER`, `MEMBER`.
  - Enforcement: Handled imperatively in services via `ProjectAccessService.assertCanView(projectId, userId)` and `assertCanManage(projectId, userId)`. Tasks also check whether the current user is the creator before allowing general edits.

### Main Entity Relationships
- `Organization` (1) -> `Project` (many): Projects belong to an organization.
- `Organization` (1) -> `OrganizationMember` (many) -> `User` (1): Users hold org-level roles.
- `Project` (1) -> `ProjectMember` (many) -> `User` (1): Users hold project-level roles.
- `Project` (1) -> `Task` (many): Tasks belong to a project and carry a project-specific key (`ENG-1`, `ENG-2`).
- `Task` (many) -> `User` (1 via `createdBy`, and soon `assignee`): Tracks who created the task and who is assigned to it.
- `Task` (1) -> `Comment` (many): Threaded comments belong to a task and reference an author `User`.

---

## Observations: Risks & Weaknesses

### 1. Broken authorization on task status updates (`PATCH /tasks/:taskId/status`)
- **What I noticed**: In `TasksController.updateStatus`, the `@CurrentUser('id')` decorator is missing, and `TasksService.updateStatus` does not call `projectAccessService.assertCanView()` or `assertCanManage()`.
- **Why it's a problem**: Any logged-in user can change the status of any task in any project, even if they don't belong to the project or organization. This is a direct cause of the reported production bug.
- **Fix now or later?**: Fix now.
- **Why**: Critical security flaw (IDOR / broken object-level authorization). The fix is straightforward: pass `userId` from the controller and verify access via `assertCanView` before updating.

### 2. Race condition in task numbering (`countDocuments + 1`)
- **What I noticed**: In `TasksService.create()`, the task number is determined by:
  ```typescript
  const taskCount = await this.taskModel.countDocuments({ projectId });
  const number = taskCount + 1;
  ```
- **Why it's a problem**: If two users create tasks at the same time, both can read the same count and get assigned the exact same task number and key (e.g. two `ENG-5` tasks). Also, if a task is deleted, `countDocuments` drops, causing collisions with future tasks.
- **Fix now or later?**: Fix now.
- **Why**: Data integrity bug that causes duplicates and unique constraint issues. It can be solved cleanly with an atomic `$inc` sequence counter on the project document and a compound unique index on `{ projectId: 1, number: 1 }`.

### 3. N+1 query risk in user resolution
- **What I noticed**: `TasksService.toSummaries()` does batching for creators (`usersService.findManyByIds`) and comment counts (Mongo aggregation), but as we add more user relations (like assignees and activity logs with actor/from/to users), there is a risk of doing individual user queries per row if not kept in check.
- **Why it's a problem**: Loading a list of 50 tasks or activity entries could easily trigger dozens of individual database queries, hurting response times.
- **Fix now or later?**: Fix now for new features, later for a full abstraction.
- **Why**: For the activity history and assignee features, I will make sure queries batch user IDs using `findManyByIds`. A more generic DataLoader pattern can wait for future refactoring.

### 4. Cascade deletes are not in a transaction
- **What I noticed**: In `TasksService.remove()`, comments and the task are deleted using `Promise.all([this.commentModel.deleteMany(...), task.deleteOne()])` without a MongoDB multi-document transaction session.
- **Why it's a problem**: If `deleteOne` fails after comments are deleted, orphaned state occurs.
- **Fix now or later?**: Fix later.
- **Why**: In standard MongoDB without a replica set, transactions aren't supported out of the box. In an intern assessment timeframe, this is acceptable to document rather than overhaul.
