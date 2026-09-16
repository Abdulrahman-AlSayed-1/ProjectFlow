'use client';

import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { CommentList } from '@/features/comments/components/comment-list';
import { formatDate } from '@/lib/format';
import { useTask } from '../hooks';
import { TaskAssigneeSelect } from './task-assignee-select';
import { TaskActivityTimeline } from './task-activity-timeline';
import { TaskPriorityBadge } from './task-priority-badge';
import { TaskStatusSelect } from './task-status-select';

interface TaskViewProps {
  projectId: string;
  taskId: string;
}

export function TaskView({ projectId, taskId }: TaskViewProps) {
  const { data: task, isPending, isError, error } = useTask(taskId);

  if (isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger">
        {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon size={14} />
        {task.project.name}
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0 space-y-6">
          <div className="space-y-2">
            <p className="font-mono text-[12px] text-muted-foreground">{task.key}</p>
            <h1 className="text-xl font-semibold leading-snug tracking-tight text-foreground">
              {task.title}
            </h1>
          </div>

          <section aria-label="Description">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Description</h2>
            {task.description ? (
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">
                {task.description}
              </p>
            ) : (
              <p className="text-[13px] italic text-subtle-foreground">
                No description was provided.
              </p>
            )}
          </section>

          <CommentList taskId={taskId} />

          <TaskActivityTimeline taskId={taskId} />
        </div>

        <aside className="space-y-5 lg:border-l lg:border-border lg:pl-6">
          <div className="space-y-1.5">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
              Status
            </h2>
            <TaskStatusSelect taskId={task.id} projectId={projectId} status={task.status} />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
              Priority
            </h2>
            <TaskPriorityBadge priority={task.priority} />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
              Assignee
            </h2>
            <TaskAssigneeSelect
              taskId={task.id}
              projectId={projectId}
              currentAssignee={task.assignee}
            />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
              Created by
            </h2>
            <div className="flex items-center gap-2">
              <Avatar user={task.createdBy} size="sm" />
              <span className="truncate text-[13px] text-foreground">{task.createdBy.name}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
              Created
            </h2>
            <p className="text-[13px] text-muted-foreground">{formatDate(task.createdAt)}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
