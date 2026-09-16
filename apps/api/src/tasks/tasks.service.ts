import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import type { Paginated, TaskActivityEntry, TaskDetail, TaskSummary } from '@projectflow/shared';
import { toUserSummary } from '../common/utils/serialize';
import { Comment, type CommentDocument } from '../comments/schemas/comment.schema';
import {
  canManage,
  canView,
  ProjectAccessContext,
  ProjectAccessService,
} from '../projects/project-access.service';
import { Project, type ProjectDocument } from '../projects/schemas/project.schema';
import { UsersService } from '../users/users.service';
import type { AssignTaskDto } from './dto/assign-task.dto';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { ListActivityQueryDto } from './dto/list-activity.dto';
import type { ListTasksQueryDto } from './dto/list-tasks.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { Task, type TaskDocument } from './schemas/task.schema';
import { TaskActivity, type TaskActivityDocument } from './schemas/task-activity.schema';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(TaskActivity.name) private readonly taskActivityModel: Model<TaskActivityDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    private readonly projectAccessService: ProjectAccessService,
    private readonly usersService: UsersService,
  ) {}

  async findByProject(
    projectId: Types.ObjectId,
    userId: Types.ObjectId,
    query: ListTasksQueryDto,
  ): Promise<Paginated<TaskSummary>> {
    await this.projectAccessService.assertCanView(projectId, userId);

    const filter: FilterQuery<TaskDocument> = { projectId };
    if (query.status) {
      filter.status = query.status;
    }
    if (query.priority) {
      filter.priority = query.priority;
    }

    const [tasks, total] = await Promise.all([
      this.taskModel.find(filter).sort({ number: 1 }).skip(query.skip).limit(query.pageSize).exec(),
      this.taskModel.countDocuments(filter),
    ]);

    return {
      items: await this.toSummaries(tasks),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(
    projectId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: CreateTaskDto,
  ): Promise<TaskDetail> {
    const { project } = await this.projectAccessService.assertCanView(projectId, userId);

    const updatedProject = await this.projectModel
      .findByIdAndUpdate(
        projectId,
        { $inc: { taskSequence: 1 } },
        { new: true },
      )
      .exec();

    if (!updatedProject) {
      throw new NotFoundException('Project not found');
    }

    const number = updatedProject.taskSequence;

    const task = await this.taskModel.create({
      projectId,
      number,
      key: `${project.key}-${number}`,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status,
      priority: dto.priority,
      createdBy: userId,
      assigneeId: null,
    });

    return this.toDetail(task, updatedProject);
  }

  async findOne(taskId: Types.ObjectId, userId: Types.ObjectId): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const { project } = await this.projectAccessService.assertCanView(task.projectId, userId);

    return this.toDetail(task, project);
  }

  async update(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: UpdateTaskDto,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const access = await this.projectAccessService.assertCanView(task.projectId, userId);

    const isCreator = task.createdBy.equals(userId);
    if (!canManage(access) && !isCreator) {
      throw new ForbiddenException('You do not have permission to edit this task');
    }

    if (dto.title !== undefined) {
      task.title = dto.title;
    }
    if (dto.description !== undefined) {
      task.description = dto.description;
    }
    if (dto.status !== undefined) {
      task.status = dto.status;
    }
    if (dto.priority !== undefined) {
      task.priority = dto.priority;
    }
    if (dto.assigneeId !== undefined) {
      const targetAssigneeId = dto.assigneeId ? new Types.ObjectId(dto.assigneeId) : null;
      await this.applyAssigneeChange(task, userId, targetAssigneeId, access);
    }

    await task.save();

    return this.toDetail(task, access.project);
  }

  async updateStatus(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: UpdateTaskStatusDto,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const access = await this.projectAccessService.assertCanView(task.projectId, userId);

    task.status = dto.status;
    await task.save();

    return this.toDetail(task, access.project);
  }

  async assignTask(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: AssignTaskDto,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const access = await this.projectAccessService.assertCanView(task.projectId, userId);
    const targetAssigneeId = dto.assigneeId ? new Types.ObjectId(dto.assigneeId) : null;

    await this.applyAssigneeChange(task, userId, targetAssigneeId, access);
    await task.save();

    return this.toDetail(task, access.project);
  }

  async getActivity(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    query: ListActivityQueryDto,
  ): Promise<Paginated<TaskActivityEntry>> {
    const task = await this.findTaskOrFail(taskId);
    await this.projectAccessService.assertCanView(task.projectId, userId);

    const [activities, total] = await Promise.all([
      this.taskActivityModel
        .find({ taskId })
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.pageSize)
        .exec(),
      this.taskActivityModel.countDocuments({ taskId }),
    ]);

    if (activities.length === 0) {
      return {
        items: [],
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    }

    // Collect all referenced user IDs without N+1 queries
    const userIds = new Set<string>();
    for (const act of activities) {
      if (act.actorId) userIds.add(act.actorId.toString());
      if (act.metadata?.from) userIds.add(act.metadata.from.toString());
      if (act.metadata?.to) userIds.add(act.metadata.to.toString());
    }

    const users = await this.usersService.findManyByIds(
      Array.from(userIds).map((id) => new Types.ObjectId(id)),
    );
    const usersById = new Map(users.map((u) => [u._id.toString(), u]));

    const items: TaskActivityEntry[] = activities.map((act) => ({
      id: act._id.toString(),
      taskId: act.taskId.toString(),
      type: act.type,
      actor: toCreatorSummary(usersById.get(act.actorId.toString())),
      metadata: {
        from: act.metadata?.from ? toCreatorSummary(usersById.get(act.metadata.from.toString())) : null,
        to: act.metadata?.to ? toCreatorSummary(usersById.get(act.metadata.to.toString())) : null,
      },
      createdAt: act.createdAt.toISOString(),
    }));

    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async applyAssigneeChange(
    task: TaskDocument,
    actorId: Types.ObjectId,
    newAssigneeId: Types.ObjectId | null,
    callerAccess: ProjectAccessContext,
  ): Promise<void> {
    const previousAssigneeId = task.assigneeId ?? null;

    const isSame =
      (previousAssigneeId === null && newAssigneeId === null) ||
      (previousAssigneeId !== null &&
        newAssigneeId !== null &&
        previousAssigneeId.equals(newAssigneeId));

    if (isSame) {
      return;
    }

    if (newAssigneeId !== null) {
      // RULE 1: Project membership - Target assignee must be a member of the project
      const assigneeAccess = await this.projectAccessService.resolve(task.projectId, newAssigneeId);
      if (!canView(assigneeAccess)) {
        throw new BadRequestException('Assignee must be a member of this project');
      }

      // RULE 2: Assignment permissions - OWNER, ADMIN, PM can assign anyone.
      // Regular member may assign task to themselves, but not to anyone else.
      const isSelfAssignment = newAssigneeId.equals(actorId);
      if (!canManage(callerAccess) && !isSelfAssignment) {
        throw new ForbiddenException(
          'Only project managers and organization owners/admins can assign other users',
        );
      }
    } else {
      // RULE 3: Unassignment - Authorized user may remove assignee.
      // OWNER, ADMIN, PM can unassign. The current assignee can unassign themselves.
      const isSelfUnassignment =
        previousAssigneeId !== null && previousAssigneeId.equals(actorId);
      if (!canManage(callerAccess) && !isSelfUnassignment) {
        throw new ForbiddenException('You do not have permission to unassign this task');
      }
    }

    task.assigneeId = newAssigneeId;

    await this.taskActivityModel.create({
      taskId: task._id,
      actorId,
      type: 'TASK_ASSIGNEE_CHANGED',
      metadata: {
        from: previousAssigneeId,
        to: newAssigneeId,
      },
    });
  }

  async remove(taskId: Types.ObjectId, userId: Types.ObjectId): Promise<void> {
    const task = await this.findTaskOrFail(taskId);
    await this.projectAccessService.assertCanManage(task.projectId, userId);

    await Promise.all([
      this.commentModel.deleteMany({ taskId: task._id }),
      this.taskActivityModel.deleteMany({ taskId: task._id }),
      task.deleteOne(),
    ]);
  }

  async findTaskOrFail(taskId: Types.ObjectId): Promise<TaskDocument> {
    const task = await this.taskModel.findById(taskId).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private async toSummaries(tasks: TaskDocument[]): Promise<TaskSummary[]> {
    if (tasks.length === 0) {
      return [];
    }

    const userIds = new Set<string>();
    for (const task of tasks) {
      userIds.add(task.createdBy.toString());
      if (task.assigneeId) {
        userIds.add(task.assigneeId.toString());
      }
    }

    const [users, commentRows] = await Promise.all([
      this.usersService.findManyByIds(Array.from(userIds).map((id) => new Types.ObjectId(id))),
      this.commentModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([
          { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
          { $group: { _id: '$taskId', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);

    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const commentCounts = new Map(commentRows.map((row) => [row._id.toString(), row.count]));

    return tasks.map((task) => ({
      id: task._id.toString(),
      projectId: task.projectId.toString(),
      number: task.number,
      key: task.key,
      title: task.title,
      status: task.status,
      priority: task.priority,
      commentCount: commentCounts.get(task._id.toString()) ?? 0,
      createdBy: toCreatorSummary(usersById.get(task.createdBy.toString())),
      assignee: task.assigneeId ? toCreatorSummary(usersById.get(task.assigneeId.toString())) : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));
  }

  private async toDetail(task: TaskDocument, project?: ProjectDocument): Promise<TaskDetail> {
    const [summary] = await this.toSummaries([task]);
    const resolvedProject = project ?? (await this.projectModel.findById(task.projectId).exec());

    if (!resolvedProject) {
      throw new NotFoundException('Project not found');
    }

    return {
      ...summary!,
      description: task.description ?? null,
      project: {
        id: resolvedProject._id.toString(),
        name: resolvedProject.name,
        key: resolvedProject.key,
      },
    };
  }
}

const DELETED_USER = {
  id: '',
  name: 'Unknown user',
  email: '',
  avatarUrl: null,
};

function toCreatorSummary(user: Parameters<typeof toUserSummary>[0] | undefined) {
  return user ? toUserSummary(user) : DELETED_USER;
}
