# AI Usage Log (`AI_LOG.md`)

This log documents my use of AI assistance during the assessment, following the four required sections.

---

## 01. Tools Used
- **AI Coding Assistant** in the IDE (used as an interactive pair programmer).

---

## 02. How I Used It
Coming from a Java / Spring Boot and React background, I used the assistant to speed up my ramp-up on the monorepo stack:
- **Framework Translation**: Quick syntax lookups for NestJS decorators (`@Prop`, `@InjectModel`) compared to Spring Boot equivalents.
- **Test Scaffolding**: Drafting initial Supertest fixture structures and request blocks to save boilerplate typing.
- **Debugging & Review**: Rubber-ducking runtime errors and troubleshooting environment quirks (like Next.js SSR hydration warnings).

---

## 03. Suggestions I Rejected & Why

1. **Optimistic Locking with Retry Loops for Task Numbering**:
   - *AI Suggestion*: Suggested using Mongoose versioning (`__v`) with a retry loop around `countDocuments + 1` to handle task key collisions.
   - *Why I Rejected It*: Retry loops introduce unpredictable latency under contention and fail if tasks are deleted (since `countDocuments` drops). Through my own research into MongoDB patterns, I found that using an atomic $inc sequence counter (taskSequence) on the Project document via findByIdAndUpdate, backed by a compound unique index, guarantees strictly monotonic IDs in a single round-trip without retries.

2. **Throwing 403 Forbidden for Invalid Target Assignees**:
   - *AI Suggestion*: Suggested throwing `ForbiddenException` (403) when assigning a user who is not a member of the project.
   - *Why I Rejected It*: A 403 tells the *caller* they lack permission. If a Project Manager (who has full permissions) assigns an outsider, the caller is authorized, but the target input is illegal. I rejected 403 and implemented `BadRequestException` (400), reserving 403 strictly for caller authorization failures.

---

## 04. Generated Code I Modified & Why

1. **Fixing N+1 Queries in Activity History**:
   - *Initial Draft*: The generated draft for `TasksService.getActivity()` queried users individually inside a loop using `this.userModel.findById()`.
   - *Why I Modified It*: This would trigger up to 60 database queries for a single page of 20 activities. I rewrote it to extract unique IDs and execute a single batched `findManyByIds()` query, hydrating users in-memory via an $O(1)$ lookup map.

2. **Supertest Socket Teardown Hangs (`ECONNRESET`)**:
   - *Initial Draft*: The generated concurrency test fired simultaneous requests using default Node Keep-Alive.
   - *Why I Modified It*: Under Node 20+, open Keep-Alive connections against the in-memory NestJS server caused intermittent `ECONNRESET` socket hang-ups during Jest teardown. I added `.set('Connection', 'close')` to each concurrent request to recycle sockets cleanly.

3. **Restricting Assignee Dropdown by Role**:
   - *Initial Draft*: The initial component draft showed all project members as assignable without checking caller permissions.
   - *Why I Modified It*: Regular members can only assign themselves. I updated the component to check the active user's role and disable non-self options with tooltips, preventing unexpected 403 errors in the UI.
