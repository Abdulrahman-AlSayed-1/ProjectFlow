import type { INestApplication } from '@nestjs/common';
import type { Connection, Types } from 'mongoose';
import request from 'supertest';
import type { AuthSession } from '@projectflow/shared';
import { OrganizationRole, ProjectRole, TaskPriority, TaskStatus } from '@projectflow/shared';

export const TEST_PASSWORD = 'Password123!';

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export async function registerUser(
  app: INestApplication,
  name: string,
  email: string,
): Promise<TestUser> {
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ name, email, password: TEST_PASSWORD })
    .expect(201);

  const session = response.body as AuthSession;
  return { id: session.user.id, email: session.user.email, token: session.accessToken };
}

export function authHeader(user: TestUser): string {
  return `Bearer ${user.token}`;
}

function toObjectId(connection: Connection, value: string): Types.ObjectId {
  return new connection.base.Types.ObjectId(value);
}

export async function createOrganization(
  connection: Connection,
  name: string,
  slug: string,
  ownerId: string,
): Promise<string> {
  const result = await connection.collection('organizations').insertOne({
    name,
    slug,
    ownerId: toObjectId(connection, ownerId),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return result.insertedId.toString();
}

export async function addOrganizationMember(
  connection: Connection,
  organizationId: string,
  userId: string,
  role: OrganizationRole,
): Promise<void> {
  await connection.collection('organization_members').insertOne({
    organizationId: toObjectId(connection, organizationId),
    userId: toObjectId(connection, userId),
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function createProject(
  connection: Connection,
  organizationId: string,
  name: string,
  key: string,
  createdBy: string,
): Promise<string> {
  const result = await connection.collection('projects').insertOne({
    organizationId: toObjectId(connection, organizationId),
    name,
    key,
    description: null,
    createdBy: toObjectId(connection, createdBy),
    taskSequence: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return result.insertedId.toString();
}

export async function addProjectMember(
  connection: Connection,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  await connection.collection('project_members').insertOne({
    projectId: toObjectId(connection, projectId),
    userId: toObjectId(connection, userId),
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function createTask(
  connection: Connection,
  projectId: string,
  projectKey: string,
  number: number,
  title: string,
  createdBy: string,
): Promise<string> {
  const result = await connection.collection('tasks').insertOne({
    projectId: toObjectId(connection, projectId),
    number,
    key: `${projectKey}-${number}`,
    title,
    description: null,
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    createdBy: toObjectId(connection, createdBy),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return result.insertedId.toString();
}
