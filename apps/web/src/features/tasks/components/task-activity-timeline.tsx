'use client';

import { useState } from 'react';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr';
import type { TaskActivityEntry } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/hooks';
import { formatRelativeTime } from '@/lib/format';
import { useTaskActivity } from '../hooks';

interface TaskActivityTimelineProps {
  taskId: string;
}

function renderActivityDescription(activity: TaskActivityEntry): string {
  const actorName = activity.actor.name;
  const from = activity.metadata?.from;
  const to = activity.metadata?.to;

  // Unassigned -> Assigned
  if (!from && to) {
    if (activity.actor.id === to.id) {
      return `${actorName} assigned themselves`;
    }
    return `${actorName} assigned ${to.name}`;
  }

  // Assigned -> Different user
  if (from && to) {
    const fromLabel = activity.actor.id === from.id ? 'themselves' : from.name;
    const toLabel = activity.actor.id === to.id ? 'themselves' : to.name;
    return `${actorName} changed the assignee from ${fromLabel} to ${toLabel}`;
  }

  // Assigned -> Unassigned
  if (from && !to) {
    if (activity.actor.id === from.id) {
      return `${actorName} removed the assignee`;
    }
    return `${actorName} removed the assignee`;
  }

  return `${actorName} updated the assignee`;
}

export function TaskActivityTimeline({ taskId }: TaskActivityTimelineProps) {
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const { data, isPending, isError, error } = useTaskActivity(taskId, page, pageSize);
  const { data: currentUser } = useCurrentUser();

  if (isPending) {
    return (
      <section aria-label="Task Activity" className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <ClockCounterClockwiseIcon size={16} className="text-muted-foreground" />
          Activity
        </h2>
        <div className="space-y-2">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-7 w-1/2" />
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section aria-label="Task Activity" className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        <p className="text-[12px] text-danger">{error.message}</p>
      </section>
    );
  }

  const activities = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = activities.length < total;

  return (
    <section aria-label="Task Activity" className="space-y-3 pt-4 border-t border-border">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <ClockCounterClockwiseIcon size={16} className="text-muted-foreground" />
          Activity
        </h2>
        {total > 0 && (
          <span className="text-[11px] text-subtle-foreground">
            {total} event{total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {activities.length === 0 ? (
        <p className="text-[13px] italic text-subtle-foreground">No activity recorded yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {activities.map((activity) => (
            <li
              key={activity.id}
              className="flex items-start justify-between gap-3 text-[13px] leading-snug"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Avatar user={activity.actor} size="sm" />
                <span className="text-foreground font-normal">
                  {renderActivityDescription(activity)}
                </span>
              </div>
              <time
                dateTime={activity.createdAt}
                className="shrink-0 text-[11px] text-subtle-foreground"
              >
                {formatRelativeTime(activity.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
