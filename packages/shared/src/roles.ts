/** Role a user holds inside an organization. */
export enum OrganizationRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

/** Role a user holds inside a single project. */
export enum ProjectRole {
  PROJECT_MANAGER = 'PROJECT_MANAGER',
  MEMBER = 'MEMBER',
}

export const ORGANIZATION_ROLES = Object.values(OrganizationRole);
export const PROJECT_ROLES = Object.values(ProjectRole);

/** Organization roles that grant access to every project in the organization. */
export const ELEVATED_ORGANIZATION_ROLES: readonly OrganizationRole[] = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
];

export function isElevatedOrganizationRole(role: OrganizationRole | null | undefined): boolean {
  return role != null && ELEVATED_ORGANIZATION_ROLES.includes(role);
}