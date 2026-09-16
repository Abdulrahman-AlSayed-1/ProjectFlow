import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  TaskPriority,
  TaskStatus,
} from '@projectflow/shared';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(3, TASK_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, TASK_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsEnum(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TASK_PRIORITIES)
  priority?: TaskPriority;

  @IsOptional()
  assigneeId?: string | null;
}
