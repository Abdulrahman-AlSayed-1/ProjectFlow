import { IsMongoId, IsOptional, ValidateIf } from 'class-validator';

export class AssignTaskDto {
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsMongoId({ message: 'assigneeId must be a valid MongoDB ObjectId or null' })
  assigneeId?: string | null;
}
