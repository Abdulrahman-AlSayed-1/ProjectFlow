import type { OrganizationRole, ProjectRole } from './roles';
import type { TaskPriority, TaskStatus } from './tasks';

/** A user as returned by the API. Never carries credential material. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

export interface ProjectSummary {
  id: string;
  organizationId: string;
  name: string;
  key: string;
  description?: string | null;
  memberCount: number;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  organization: OrganizationSummary;
  createdBy: UserSummary;
}

export interface ProjectMemberEntry {
  id: string;
  projectId: string;
  role: ProjectRole;
  user: UserSummary;
  createdAt: string;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  commentCount: number;
  createdBy: UserSummary;
  assignee: UserSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends TaskSummary {
  description?: string | null;
  project: Pick<ProjectSummary, 'id' | 'name' | 'key'>;
}

export interface TaskActivityEntry {
  id: string;
  taskId: string;
  type: string;
  actor: UserSummary;
  metadata: {
    from: UserSummary | null;
    to: UserSummary | null;
  };
  createdAt: string;
}

export interface CommentEntry {
  id: string;
  taskId: string;
  content: string;
  author: UserSummary;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  accessToken: string;
  user: UserSummary;
}

export interface CurrentUser extends UserSummary {
  organizations: Array<OrganizationSummary & { role: OrganizationRole }>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Shape produced by the API's exception filter for every non-2xx response. */
export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error: string;
}
