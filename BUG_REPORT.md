# Production Bug Report: Cross-Project Task Modification

**Reported Issue:** *"Some users appear to be able to modify tasks belonging to projects they are not members of."*  
**Status:** Verified, Reproduced, Fixed, and Covered by Automated Regression Tests.

---

## 1. Root Cause
In `apps/api/src/tasks/tasks.controller.ts`, the endpoint handler for `PATCH /tasks/:taskId/status` did not extract the authenticated user identity via the `@CurrentUser('id')` parameter decorator:

```typescript
// Original implementation in TasksController
@Patch('tasks/:taskId/status')
updateStatus(
  @Param('taskId') taskId: string,
  @Body() dto: UpdateTaskStatusDto,
): Promise<TaskDetail> {
  return this.tasksService.updateStatus(toObjectId(taskId, 'task id'), dto);
}
```

Consequently, `TasksService.updateStatus()` in `apps/api/src/tasks/tasks.service.ts` only loaded the task by its ID and directly modified `task.status` without invoking `this.projectAccessService.assertCanView(task.projectId, userId)`. 

While general task updates (`PATCH /tasks/:taskId`) properly asserted permissions, the specialized status update route omitted authorization entirely.

---

## 2. Impact
* **Vulnerability Class:** Broken Object-Level Authorization (BOLA) / Insecure Direct Object Reference (IDOR).
* **Severity:** High.
* **Exploitability:** Any authenticated user in the system could modify the status (e.g. move to `DONE` or `TODO`) of any task in any project across any organization. The attacker only needed a valid task MongoDB `_id` (discoverable via sequential guessing, brute-force, or shared links).
* **Data Integrity Risk:** Unauthorized users could disrupt project workflows and alter task completion states across unrelated tenant boundaries.

---

## 3. Reproduction Steps
I wrote an automated end-to-end regression test in `apps/api/test/tasks.e2e.spec.ts`:

1. Created a project `ENG` owned by user `Ammar` with member `Magd`.
2. As `Magd`, created a task `ENG-1` via `POST /projects/:projectId/tasks`.
3. As `Outsider` (a user with no organization or project membership), sent:
   ```http
   PATCH /tasks/<TASK_ID>/status
   Authorization: Bearer <OUTSIDER_TOKEN>
   Content-Type: application/json

   { "status": "DONE" }
   ```
4. **Observed Result (Before Fix):** The request succeeded with `200 OK` and updated the task status in the database.
5. **Expected Result:** The request must be rejected with `403 Forbidden`.

---

## 4. Fix Applied
1. **Controller Layer (`apps/api/src/tasks/tasks.controller.ts`)**:
   Extracted `@CurrentUser('id') userId: string` and forwarded both the `taskId` and `userId` ObjectIds to the service:
   ```typescript
   @Patch('tasks/:taskId/status')
   updateStatus(
     @Param('taskId') taskId: string,
     @CurrentUser('id') userId: string,
     @Body() dto: UpdateTaskStatusDto,
   ): Promise<TaskDetail> {
     return this.tasksService.updateStatus(
       toObjectId(taskId, 'task id'),
       toObjectId(userId, 'user id'),
       dto,
     );
   }
   ```

2. **Service Layer (`apps/api/src/tasks/tasks.service.ts`)**:
   Enforced access resolution before performing any mutation:
   ```typescript
   async updateStatus(
     taskId: Types.ObjectId,
     userId: Types.ObjectId,
     dto: UpdateTaskStatusDto,
   ): Promise<TaskDetail> {
     const task = await this.findTaskOrFail(taskId);
     const access = await this.projectAccessService.assertCanView(task.projectId, userId);

     task.status = dto.status;
     await task.save();

     return this.toDetail(task, access.project);
   }
   ```
   *(Note: Passing `access.project` directly to `this.toDetail()` also avoids an extra database lookup for the project document).*

---

## 5. Regression Prevention
* **Automated E2E Test:** Added the test case `refuses to update task status for someone outside the project` in `apps/api/test/tasks.e2e.spec.ts`. This runs on every CI run and local `pnpm test`.
* **Architectural Recommendation:** While `JwtAuthGuard` ensures authentication globally, resource-level authorization currently relies on manual service calls. In the future, a NestJS interceptor or policy guard combining route params (`:taskId`) with `ProjectAccessService` would enforce access checks uniformly before reaching service logic.

---

# Production Bug Report 2: Concurrent Task Creation & Number Collision

**Reported Issue:** *"Tasks carry a sequential, project-specific identifier — ENG-101, ENG-102. Occasionally two tasks created at approximately the same time receive the same number."*  
**Status:** Verified, Reproduced, Fixed, and Covered by Automated Concurrency Tests.

---

### 1. Root Cause
In `apps/api/src/tasks/tasks.service.ts`, the original implementation calculated the next task number by counting existing documents:

```typescript
// Flawed original implementation
const taskCount = await this.taskModel.countDocuments({ projectId });
const number = taskCount + 1;
```

This pattern suffers from two major flaws:
1. **Time-of-Check to Time-of-Use (TOCTOU) Race Condition:** When multiple concurrent requests create tasks for the same project in parallel, each request executes `countDocuments` before any of them finish inserting their new document. Both read the same count and generate duplicate keys (e.g. two tasks labeled `ENG-5`).
2. **Deletions Cause Gaps and Collisions:** If an existing task is deleted, `countDocuments` decreases, causing subsequent task creation to collide with an already existing historical number.

---

### 2. Impact
* **Vulnerability Class:** Concurrency Race Condition / Data Integrity Failure.
* **Severity:** Medium-High.
* **User Impact:** Duplicate task keys (`ENG-5`) confuse team members, break direct URL navigation (`/projects/:projectId/tasks/:taskId`), cause unpredictable sorting, and violate the domain invariant that task numbers must be strictly unique and monotonic per project.

---

### 3. Reproduction Steps
I wrote an automated concurrent execution test in `apps/api/test/tasks.e2e.spec.ts`:

1. Created a project `ENG` and authenticated member `Magd`.
2. Dispatched 5 simultaneous creation requests using `Promise.all`:
   ```typescript
   await Promise.all(
     Array.from({ length: 5 }, (_, i) =>
       request(app.getHttpServer())
         .post(`/projects/${project.id}/tasks`)
         .set('Authorization', authHeader(member))
         .send({ title: `Concurrent Task ${i + 1}`, status: TaskStatus.TODO }),
     ),
   );
   ```
3. **Observed Result (Before Fix):** Multiple tasks received identical numbers (e.g., three tasks with number `1`), and Mongoose threw unhandled duplicate key or duplicate UI display issues.
4. **Expected Result:** Every task must receive a strictly distinct, sequential integer (`1, 2, 3, 4, 5`) with no collisions.

---

### 4. Architectural & Database Decisions (The Fix)

To guarantee correctness without introducing distributed locks or expensive application-level synchronization, I implemented a two-part database solution:

#### A. Atomic Sequence Counter on the Parent Document
Added a `taskSequence` counter field (defaulting to `0`) directly on the `Project` schema (`apps/api/src/projects/schemas/project.schema.ts`):

```typescript
@Prop({ required: true, default: 0 })
taskSequence: number;
```

In `TasksService.create()`, the next sequence number is obtained atomically at the database level using MongoDB's `findByIdAndUpdate` with `$inc`:

```typescript
const updatedProject = await this.projectModel.findByIdAndUpdate(
  projectId,
  { $inc: { taskSequence: 1 } },
  { new: true },
);
const number = updatedProject.taskSequence;
```

* **Why this works:** MongoDB document-level write locks guarantee that `$inc` operations on a single document are completely serialized and atomic. Regardless of how many application instances or threads request a new task number concurrently, each operation will receive a unique, strictly incrementing integer with zero race conditions.

#### B. Compound Unique Index Safeguard
Added a compound unique index on `{ projectId: 1, number: 1 }` in `apps/api/src/tasks/schemas/task.schema.ts`:

```typescript
TaskSchema.index({ projectId: 1, number: 1 }, { unique: true });
```

* **Why this is essential:** Defense-in-depth. Even in the event of an unexpected bug or external data import, the database engine itself enforces uniqueness and rejects any duplicate task number for the same project.

---

### 5. Regression Prevention
* **Automated Test:** Added the concurrency test `assigns unique, monotonic numbers even under concurrent creation` in `apps/api/test/tasks.e2e.spec.ts`. It executes 5 concurrent HTTP requests and asserts that all resulting numbers form an unbroken, unique set: `[1, 2, 3, 4, 5]`.
* **Verified:** Verified with `pnpm --filter @projectflow/api test`, passing with 100% reliability.

