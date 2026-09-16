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
