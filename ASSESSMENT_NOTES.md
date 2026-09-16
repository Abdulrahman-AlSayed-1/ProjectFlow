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
- `Task` (many) -> `User` (1 via `createdBy`, and 1 via nullable `assigneeId`): Each task points to at most one assigned user, while a single user can be assigned to multiple tasks.
- `Task` (1) -> `TaskActivity` (many): An append-only audit log capturing lifecycle events (e.g. assignee changes) on the task.
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

---

## Code Review

**PR Context**: A pull request implementing task assignment with the following service function:

```typescript
async assignTask(taskId: string, assigneeId: string, userId: string) {
  const task = await this.taskModel.findById(taskId);
  if (!task) { throw new NotFoundException(); }
  const user = await this.userModel.findById(assigneeId);
  if (!user) { throw new NotFoundException(); }
  task.assignee = user._id;
  await task.save();
  return task;
}
```

### Review Comments & Requested Changes

1. **Security & Caller Authorization (Critical)**
   - **Issue**: `userId` is accepted as a parameter but completely unused. There is no access check verifying if the caller belongs to `task.projectId` or has rights to modify this task.
   - **Why change**: Any logged-in user who guesses or discovers a `taskId` can reassign tasks in any project across the entire organization. We must invoke `this.projectAccessService.resolve(task.projectId, userId)` and reject unauthorized callers with a `ForbiddenException` (403).

2. **Cross-Tenant Project Membership Leak (Rule #1 Violation)**
   - **Issue**: `this.userModel.findById(assigneeId)` only verifies that the target user exists globally in the database. It does not check if the user is a member of `task.projectId`.
   - **Why change**: A user from another organization or someone with no project access could be assigned to sensitive internal tasks. We must verify membership against `task.projectId` using `this.projectAccessService.resolve(task.projectId, assigneeId)` and throw a `BadRequestException` (400) if they are not in the project.

3. **Role-Based Permission Enforcement (Rule #2 Violation)**
   - **Issue**: Regular members are allowed to assign anyone in this snippet.
   - **Why change**: Our business rules dictate that regular project members may only assign tasks to *themselves*. Elevating assignments (assigning other teammates) is restricted to `OWNER`, `ADMIN`, and `PROJECT_MANAGER`. If a regular member attempts to assign someone other than themselves, we must return a `ForbiddenException` (403).

4. **No Support for Unassignment (Rule #3 Violation)**
   - **Issue**: `assigneeId` is typed as a required `string`. Passing `null` or `undefined` to unassign a task either fails validation or triggers `findById(null)`.
   - **Why change**: Tasks must be unassignable (`assigneeId: string | null`). When unassigning, we must also enforce Rule #3: only a manager (`OWNER`, `ADMIN`, `PROJECT_MANAGER`) or the currently assigned user may remove the assignment.

5. **Missing Audit Trail (Task Activity History)**
   - **Issue**: The function updates `task.assignee` directly without logging any activity record.
   - **Why change**: Our product specification requires maintaining an immutable activity log for assignment changes (`TASK_ASSIGNEE_CHANGED`) recording who made the change (`actorId`), the previous assignee (`from`), and the new assignee (`to`). Without this, the activity timeline feature breaks.

6. **Schema & Naming Mismatch**
   - **Issue**: The snippet sets `task.assignee = user._id;`, but the Mongoose schema property is `assigneeId`.
   - **Why change**: Depending on Mongoose strict schema settings, assigning to `task.assignee` will either be silently dropped on save or store an untyped, unindexed property, leaving `task.assigneeId` as `null`.

7. **No-Op Guard & Performance**
   - **Issue**: If `assigneeId` equals the current `task.assigneeId`, the function still performs a user query, writes to the database, and emits an event.
   - **Why change**: Adding an early return `if (task.assigneeId?.toString() === assigneeId) return task;` avoids redundant database writes and prevents cluttering the activity history with phantom duplicate entries.

---

## Scaling the Activity System

As ProjectFlow grows from 5,000 to 500,000 users, the activity log transitions from a lightweight feature to the largest, fastest-growing dataset in the database. Every task edit, comment, and reassignment generates an append-only event. Below is how I would evolve this system at each scale milestone.

### 1. Database Indexing & Query Strategy
- **Current State**: We have a compound index on `{ taskId: 1, createdAt: -1 }`. For single-task timeline lookups, this provides an efficient B-tree traversal with no memory sort.
- **At 500k Users**:
  - Task-specific feeds remain fast with `{ taskId: 1, createdAt: -1 }`.
  - However, enterprise teams require project-level and organization-level activity feeds ("what changed in project X today?").
  - To support these without scanning entire collections, we must denormalize `projectId` and `orgId` onto `TaskActivity` and introduce compound indexes: `{ projectId: 1, createdAt: -1 }` and `{ orgId: 1, createdAt: -1 }`.

### 2. Transition from Offset to Cursor-Based Pagination
- **The Problem with Offset (`skip` / `limit`)**:
  - Right now, pagination uses `skip((page - 1) * pageSize).limit(pageSize)`.
  - In MongoDB, `skip(10000)` requires the storage engine to walk and discard 10,000 index entries. As activity tables reach tens of millions of rows, deep pagination response times degrade exponentially.
  - Furthermore, offset pagination suffers from "page drift": if 5 new events occur while a user is reading page 1, navigating to page 2 duplicates items seen on page 1.
- **The Solution (Cursor / Keyset Pagination)**:
  - Migrate the API to keyset pagination using the compound tuple `(createdAt, _id)` or MongoDB's naturally monotonic `_id`.
  - The client passes `?cursor=<last_seen_id>&limit=20`.
  - The query becomes:
    ```javascript
    activityModel
      .find({ taskId, _id: { $lt: cursor } })
      .sort({ _id: -1 })
      .limit(pageSize + 1);
    ```
  - This is strictly an $O(1)$ index seek regardless of whether the user is on item 10 or item 1,000,000.

### 3. Decoupling Writes via Asynchronous Message Queues
- **The Problem with Inline Synchronous Writes**:
  - Currently, when a user changes an assignee or task status, the HTTP handler waits for both the task update and the activity insert to complete before returning `200 OK`.
  - Under peak traffic (e.g. bulk reassignments, automated CI bot updates), database write contention on the activity collection slows down the primary task update latency, and an activity write failure risks aborting the user's task mutation.
- **The Solution**:
  - Decouple mutation from audit logging using an in-memory queue (e.g. BullMQ backed by Redis, or Kafka/RabbitMQ for enterprise scale).
  - The task mutation handler updates the task, emits a domain event (`TaskAssigneeChangedEvent`), and immediately responds to the client.
  - A pool of background workers consumes the events and batches inserts into MongoDB (`insertMany`), drastically reducing database IOPS through write coalescing.

### 4. Data Growth, Partitioning & Storage Tiering
- **Access Pattern Analysis**:
  - Over 95% of activity queries target events created within the last 14 to 30 days. Activity older than 90 days is rarely viewed, yet consumes valuable database memory (WiredTiger cache).
- **Architecture Evolution**:
  - **Horizontal Sharding**: Shard the `task_activities` collection on `{ projectId: 'hashed', createdAt: -1 }`. This ensures write throughput is distributed evenly across MongoDB shards while keeping all activities for a project localized when querying project feeds.
  - **Cold Storage Tiering / Archival**: Implement an automated lifecycle policy (e.g. MongoDB Atlas Online Archive or an overnight worker job) that moves activity records older than 180 days to compressed cold storage (S3 / Parquet) queryable via Athena or Atlas Data Lake. This keeps the primary database working set compact and memory-resident.

### 5. Real-Time Delivery & Caching
- **Real-Time WebSockets**: At 500k users, polling for activity or relying on manual refreshes creates unnecessary read load. Emitting activity events over WebSockets (via Redis Pub/Sub backplane) pushes updates instantly to users who have that task open.
- **Read-Through Caching**: The first page of activity (the most recent 20 events) can be cached in Redis with a short TTL (e.g., 60 seconds) or invalidated directly by the queue worker on write.

---

## If I Had Two More Days

Given two additional working days, I would prioritize improvements that deliver the highest leverage for user experience, data integrity, and engineering maintainability:

### Priority 1: Real-Time Multi-User Collaboration (WebSockets / SSE)
- **Why it's #1**: ProjectFlow is a collaborative tool. When Team Member A assigns a task to Team Member B, Team Member B currently has no way of knowing unless they refresh the page or poll.
- **Implementation**: Introduce a NestJS Gateway using `@nestjs/platform-socket.io` with a Redis Pub/Sub adapter. When `TaskActivity` is recorded, broadcast a typed event (`task.assignee_changed`) to the room `project:${projectId}`. On the frontend, TanStack Query listens to socket events and calls `queryClient.setQueryData` to update task cards and the activity timeline in real time without a network refetch.

### Priority 2: Comprehensive Task Audit Trail (Generalizing the Activity Model)
- **Why it's #2**: Currently, `TaskActivity` only records assignee updates. In a production issue tracker, users expect to see who changed the status, modified the priority, updated the title, or edited the description.
- **Implementation**: Generalize `TaskActivity` with a union of event types (`TASK_STATUS_CHANGED`, `TASK_PRIORITY_CHANGED`, `TASK_UPDATED`). Implement a unified Mongoose post-save / service interception layer that diffs previous and next states and writes activity logs automatically, keeping business logic clean and DRY.

### Priority 3: Migration to Keyset / Cursor Pagination & Virtualized List
- **Why it's #3**: While page-based pagination works well for small lists, high-activity tasks benefit from an infinite-scrolling feed (like GitHub or Linear) rather than paginated buttons.
- **Implementation**: Migrate `GET /tasks/:taskId/activity` to accept a `cursor` parameter and return `nextCursor`. Replace the Next/Previous buttons on the frontend with TanStack Query's `useInfiniteQuery` paired with `@tanstack/react-virtual` to ensure smooth 60fps scrolling even with hundreds of timeline entries.

### Priority 4: End-to-End Testing with Playwright & React Testing Library
- **Why it's #4**: We have comprehensive backend integration tests (28 passing E2E tests), but frontend components rely on manual verification.
- **Implementation**: Add React Testing Library tests for the `TaskAssigneeSelect` and `TaskActivityTimeline` components to assert that unauthorized users see disabled dropdowns and correct tooltips. Add a Playwright E2E test verifying the complete user journey: logging in, opening a task, assigning a member, and observing the activity timeline entry.

