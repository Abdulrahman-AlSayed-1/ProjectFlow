import type {
  Paginated,
  TaskActivityEntry,
  TaskDetail,
  TaskPriority,
  TaskStatus,
  TaskSummary,
} from '@projectflow/shared';
import { apiRequest } from '@/lib/api-client';

export interface CreateTaskPayload {
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
}

/** The board renders every column at once, so tasks are fetched in one page. */
const BOARD_PAGE_SIZE = 100;

export function fetchProjectTasks(projectId: string): Promise<Paginated<TaskSummary>> {
  return apiRequest<Paginated<TaskSummary>>(`/projects/${projectId}/tasks`, {
    query: { page: 1, pageSize: BOARD_PAGE_SIZE },
  });
}

export function fetchTask(taskId: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}`);
}

export function createTask(projectId: string, payload: CreateTaskPayload): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/projects/${projectId}/tasks`, {
    method: 'POST',
    body: payload,
  });
}

export function updateTaskStatus(taskId: string, status: TaskStatus): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}/status`, {
    method: 'PATCH',
    body: { status },
  });
}

export function updateTask(
  taskId: string,
  payload: Partial<Pick<CreateTaskPayload, 'title' | 'description' | 'priority'>>,
): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export function assignTask(taskId: string, assigneeId: string | null): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}/assignee`, {
    method: 'PATCH',
    body: { assigneeId },
  });
}

export function fetchTaskActivity(
  taskId: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<Paginated<TaskActivityEntry>> {
  return apiRequest<Paginated<TaskActivityEntry>>(`/tasks/${taskId}/activity`, {
    query: { page, pageSize },
  });
}
