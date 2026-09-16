import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { OrganizationRole, ProjectRole, TaskPriority, TaskStatus } from '@projectflow/shared';
import { createTestApp, resetDatabase } from './utils/test-app';
import {
  addOrganizationMember,
  addProjectMember,
  authHeader,
  createOrganization,
  createProject,
  registerUser,
  type TestUser,
} from './utils/fixtures';

describe('Tasks', () => {
  let app: INestApplication;
  let connection: Connection;

  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let projectId: string;

  beforeAll(async () => {
    ({ app, connection } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(connection);

    owner = await registerUser(app, 'Ammar Yaser', 'ammar@example.com');
    member = await registerUser(app, 'Magd Ali', 'magd@example.com');
    outsider = await registerUser(app, 'Outside User', 'outside@example.com');

    const organizationId = await createOrganization(
      connection,
      'Acme Software',
      'acme-software',
      owner.id,
    );
    await addOrganizationMember(connection, organizationId, owner.id, OrganizationRole.OWNER);
    await addOrganizationMember(connection, organizationId, member.id, OrganizationRole.MEMBER);

    projectId = await createProject(
      connection,
      organizationId,
      'Internal Platform',
      'ENG',
      owner.id,
    );
    await addProjectMember(connection, projectId, member.id, ProjectRole.MEMBER);
  });

  it('lets a project member create a task', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({
        title: 'Improve API error handling',
        description: 'Normalise validation and permission errors.',
        priority: TaskPriority.HIGH,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      key: 'ENG-1',
      number: 1,
      title: 'Improve API error handling',
      status: TaskStatus.TODO,
      priority: TaskPriority.HIGH,
    });
    expect(response.body.createdBy).toMatchObject({ email: 'magd@example.com' });
  });

  it('numbers tasks sequentially within a project', async () => {
    for (const title of ['First task', 'Second task', 'Third task']) {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks`)
        .set('Authorization', authHeader(member))
        .send({ title })
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(3);
    expect(response.body.items.map((task: { key: string }) => task.key)).toEqual([
      'ENG-1',
      'ENG-2',
      'ENG-3',
    ]);
  });

  it('refuses to create a task for someone outside the project', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(outsider))
      .send({ title: 'Should not be created' })
      .expect(403);
  });

  it('refuses to list tasks for someone outside the project', async () => {
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(outsider))
      .expect(403);
  });

  it('rejects a task without a usable title', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'ab' })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
  });

  it('filters the task list by status', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Work in flight', status: TaskStatus.IN_PROGRESS })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Not started yet' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .query({ status: TaskStatus.IN_PROGRESS })
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({ title: 'Work in flight' });
  });

  it('refuses to update task status for someone outside the project', async () => {
    const created = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Task to protect' })
      .expect(201);

    const taskId = created.body.id;

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/status`)
      .set('Authorization', authHeader(outsider))
      .send({ status: TaskStatus.DONE })
      .expect(403);
  });

  it('generates unique sequential identifiers under concurrent task creation', async () => {
    const titles = ['Task Alpha', 'Task Beta', 'Task Gamma', 'Task Delta', 'Task Epsilon'];

    const responses = await Promise.all(
      titles.map((title) =>
        request(app.getHttpServer())
          .post(`/projects/${projectId}/tasks`)
          .set('Authorization', authHeader(member))
          .set('Connection', 'close')
          .send({ title }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const numbers = responses.map((res) => res.body.number as number);
    const keys = responses.map((res) => res.body.key as string);

    expect(new Set(numbers).size).toBe(5);
    expect(numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(keys).size).toBe(5);
  });

  describe('Task Assignment & Activity History', () => {
    let secondMember: TestUser;
    let taskId: string;

    beforeEach(async () => {
      secondMember = await registerUser(app, 'Sarah Developer', 'sarah.dev@example.com');
      const projectDoc = await connection.collection('projects').findOne({ _id: new connection.base.Types.ObjectId(projectId) });
      await addOrganizationMember(connection, projectDoc!.organizationId.toString(), secondMember.id, OrganizationRole.MEMBER);
      await addProjectMember(connection, projectId, secondMember.id, ProjectRole.MEMBER);

      const taskRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks`)
        .set('Authorization', authHeader(member))
        .send({ title: 'Assignment test task' })
        .expect(201);
      taskId = taskRes.body.id;
    });

    it('allows a project member to assign a task to themselves', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/assignee`)
        .set('Authorization', authHeader(member))
        .send({ assigneeId: member.id })
        .expect(200);

      expect(response.body.assignee).toMatchObject({ email: member.email, name: 'Magd Ali' });
    });

    it('allows an authorized project role (OWNER/PM) to assign another project member', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/assignee`)
        .set('Authorization', authHeader(owner))
        .send({ assigneeId: secondMember.id })
        .expect(200);

      expect(response.body.assignee).toMatchObject({ email: secondMember.email, name: 'Sarah Developer' });
    });

    it('refuses to let a regular member assign another user', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/assignee`)
        .set('Authorization', authHeader(member))
        .send({ assigneeId: secondMember.id })
        .expect(403);
    });

    it('refuses to assign a user outside the project', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/assignee`)
        .set('Authorization', authHeader(owner))
        .send({ assigneeId: outsider.id })
        .expect(400);
    });

    it('tracks activity across all three assignee transitions and supports pagination', async () => {
      // Transition 1: Unassigned -> Assigned
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/assignee`)
        .set('Authorization', authHeader(member))
        .send({ assigneeId: member.id })
        .expect(200);

      // Transition 2: Assigned -> Different user
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/assignee`)
        .set('Authorization', authHeader(owner))
        .send({ assigneeId: secondMember.id })
        .expect(200);

      // Transition 3: Assigned -> Unassigned
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/assignee`)
        .set('Authorization', authHeader(owner))
        .send({ assigneeId: null })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/tasks/${taskId}/activity`)
        .set('Authorization', authHeader(member))
        .expect(200);

      expect(response.body.total).toBe(3);
      expect(response.body.items).toHaveLength(3);

      // Newest first:
      // Item 0: Assigned -> Unassigned
      expect(response.body.items[0]).toMatchObject({
        type: 'TASK_ASSIGNEE_CHANGED',
        actor: { email: owner.email },
        metadata: {
          from: { email: secondMember.email },
          to: null,
        },
      });

      // Item 1: Assigned -> Different user
      expect(response.body.items[1]).toMatchObject({
        type: 'TASK_ASSIGNEE_CHANGED',
        actor: { email: owner.email },
        metadata: {
          from: { email: member.email },
          to: { email: secondMember.email },
        },
      });

      // Item 2: Unassigned -> Assigned
      expect(response.body.items[2]).toMatchObject({
        type: 'TASK_ASSIGNEE_CHANGED',
        actor: { email: member.email },
        metadata: {
          from: null,
          to: { email: member.email },
        },
      });
    });

    it('refuses to return activity history to someone outside the project', async () => {
      await request(app.getHttpServer())
        .get(`/tasks/${taskId}/activity`)
        .set('Authorization', authHeader(outsider))
        .expect(403);
    });
  });
});


