import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Paginated, TaskActivityEntry, TaskDetail, TaskSummary } from '@projectflow/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { toObjectId } from '../common/utils/object-id';
import { AssignTaskDto } from './dto/assign-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListActivityQueryDto } from './dto/list-activity.dto';
import { ListTasksQueryDto } from './dto/list-tasks.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { TasksService } from './tasks.service';

@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('projects/:projectId/tasks')
  findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<Paginated<TaskSummary>> {
    return this.tasksService.findByProject(
      toObjectId(projectId, 'project id'),
      toObjectId(userId, 'user id'),
      query,
    );
  }

  @Post('projects/:projectId/tasks')
  create(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskDetail> {
    return this.tasksService.create(
      toObjectId(projectId, 'project id'),
      toObjectId(userId, 'user id'),
      dto,
    );
  }

  @Get('tasks/:taskId')
  findOne(@Param('taskId') taskId: string, @CurrentUser('id') userId: string): Promise<TaskDetail> {
    return this.tasksService.findOne(toObjectId(taskId, 'task id'), toObjectId(userId, 'user id'));
  }

  @Patch('tasks/:taskId')
  update(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskDetail> {
    return this.tasksService.update(
      toObjectId(taskId, 'task id'),
      toObjectId(userId, 'user id'),
      dto,
    );
  }

  @Patch('tasks/:taskId/status')
  updateStatus(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<TaskDetail> {
    return this.tasksService.updateStatus(
      toObjectId(taskId, 'task id'),
      toObjectId(userId, 'user id'),
      dto,
    );
  }

  @Patch('tasks/:taskId/assignee')
  assignTask(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AssignTaskDto,
  ): Promise<TaskDetail> {
    return this.tasksService.assignTask(
      toObjectId(taskId, 'task id'),
      toObjectId(userId, 'user id'),
      dto,
    );
  }

  @Get('tasks/:taskId/activity')
  getActivity(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListActivityQueryDto,
  ): Promise<Paginated<TaskActivityEntry>> {
    return this.tasksService.getActivity(
      toObjectId(taskId, 'task id'),
      toObjectId(userId, 'user id'),
      query,
    );
  }

  @Delete('tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('taskId') taskId: string, @CurrentUser('id') userId: string): Promise<void> {
    return this.tasksService.remove(toObjectId(taskId, 'task id'), toObjectId(userId, 'user id'));
  }
}
