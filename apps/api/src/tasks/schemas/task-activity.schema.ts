import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export type TaskActivityDocument = HydratedDocument<TaskActivity>;

@Schema({ timestamps: true, collection: 'task_activities' })
export class TaskActivity {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true, index: true })
  taskId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['TASK_ASSIGNEE_CHANGED'] })
  type: string;

  @Prop({
    type: {
      from: { type: Types.ObjectId, ref: 'User', default: null },
      to: { type: Types.ObjectId, ref: 'User', default: null },
    },
    required: true,
    _id: false,
  })
  metadata: {
    from: Types.ObjectId | null;
    to: Types.ObjectId | null;
  };

  createdAt: Date;
  updatedAt: Date;
}

export const TaskActivitySchema = SchemaFactory.createForClass(TaskActivity);

TaskActivitySchema.index({ taskId: 1, createdAt: -1 });
