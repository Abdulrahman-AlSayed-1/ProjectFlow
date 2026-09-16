/** Central query-key registry so invalidation stays predictable. */
export const queryKeys = {
  currentUser: ['current-user'] as const,
  projects: ['projects'] as const,
  project: (projectId: string) => ['projects', projectId] as const,
  projectMembers: (projectId: string) => ['projects', projectId, 'members'] as const,
  projectTasks: (projectId: string) => ['projects', projectId, 'tasks'] as const,
  task: (taskId: string) => ['tasks', taskId] as const,
  taskComments: (taskId: string) => ['tasks', taskId, 'comments'] as const,
  taskActivity: (taskId: string) => ['tasks', taskId, 'activity'] as const,
};
