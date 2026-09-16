'use client';

import { toast } from 'sonner';
import { isElevatedOrganizationRole, ProjectRole, type UserSummary } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrentUser } from '@/features/auth/hooks';
import { useProjectMembers } from '@/features/projects/hooks';
import { useAssignTask } from '../hooks';

const UNASSIGNED_VALUE = 'UNASSIGNED';

interface TaskAssigneeSelectProps {
  taskId: string;
  projectId: string;
  currentAssignee: UserSummary | null;
}

export function TaskAssigneeSelect({
  taskId,
  projectId,
  currentAssignee,
}: TaskAssigneeSelectProps) {
  const { data: currentUser } = useCurrentUser();
  const { data: members, isPending: membersLoading } = useProjectMembers(projectId);
  const assignTask = useAssignTask(taskId, projectId);

  const isElevated =
    currentUser?.organizations.some((org) => isElevatedOrganizationRole(org.role)) ?? false;
  const myMemberRecord = members?.find((m) => m.user.id === currentUser?.id);
  const isProjectManager = myMemberRecord?.role === ProjectRole.PROJECT_MANAGER;
  const canManageAssignment = isElevated || isProjectManager;

  const handleValueChange = (value: string) => {
    const nextAssigneeId = value === UNASSIGNED_VALUE ? null : value;
    assignTask.mutate(nextAssigneeId, {
      onError: (error) => toast.error(error.message),
      onSuccess: () => {
        toast.success(nextAssigneeId ? 'Task assigned' : 'Task unassigned');
      },
    });
  };

  const selectedValue = currentAssignee?.id ?? UNASSIGNED_VALUE;

  return (
    <div className="space-y-1">
      <Select
        value={selectedValue}
        disabled={membersLoading || assignTask.isPending}
        onValueChange={handleValueChange}
      >
        <SelectTrigger aria-label="Assignee" className="h-8">
          <SelectValue>
            {currentAssignee ? (
              <div className="flex items-center gap-2">
                <Avatar user={currentAssignee} size="sm" />
                <span className="truncate text-[13px]">{currentAssignee.name}</span>
              </div>
            ) : (
              <span className="text-[13px] text-muted-foreground">Unassigned</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED_VALUE}>
            <span className="text-muted-foreground italic">Unassigned</span>
          </SelectItem>

          {members?.map((member) => {
            const isSelf = member.user.id === currentUser?.id;
            const canAssignThisMember = canManageAssignment || isSelf;

            return (
              <SelectItem
                key={member.user.id}
                value={member.user.id}
                disabled={!canAssignThisMember}
              >
                <div className="flex items-center gap-2">
                  <Avatar user={member.user} size="sm" />
                  <span className="truncate">{member.user.name}</span>
                  {isSelf && (
                    <span className="text-[11px] text-subtle-foreground font-normal">(you)</span>
                  )}
                  {!canAssignThisMember && (
                    <span className="text-[10px] text-muted-foreground/70 font-normal">
                      (PM only)
                    </span>
                  )}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
