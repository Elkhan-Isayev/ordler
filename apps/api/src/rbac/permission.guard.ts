import {
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  can,
  ORGANIZATION_SCOPE,
  type AuthStrategyKind,
  type OrgDirectory,
  type Permission,
  type RoleAssignment,
  type RolePermissionLookup,
  type Scope,
} from '@ordler/shared';

export const PUBLIC_ROUTE = 'ordler:public-route';
export const AUTHENTICATED_ROUTE = 'ordler:authenticated-route';
export const REQUIRED_PERMISSION = 'ordler:required-permission';

/** The authenticated member, attached to the request by the session hook. */
export interface RequestMember {
  id: string;
  /** How the current session was established; used by lock-out protection. */
  strategyKind?: AuthStrategyKind;
}

export interface AuthorizedRequest {
  member?: RequestMember;
  params?: Record<string, string | undefined>;
}

export type ScopeResolver = (request: AuthorizedRequest) => Scope | undefined;

interface PermissionRequirement {
  permission: Permission;
  scope: ScopeResolver;
}

export interface MemberAccess {
  assignments: readonly RoleAssignment[];
  rolePermissions: RolePermissionLookup;
  directory: OrgDirectory;
}

/** Loads everything RBAC needs for one member; backed by the database in production. */
export interface AccessContextSource {
  load(memberId: string): Promise<MemberAccess>;
}

export const ACCESS_CONTEXT = Symbol('ACCESS_CONTEXT');

/** Marks a route as reachable without authentication (health checks, sign-in). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Any signed-in member may call the route (their own profile, sign-out). */
export const Authenticated = () => SetMetadata(AUTHENTICATED_ROUTE, true);

/**
 * Declares the permission a route needs and where it applies. Without a resolver the check
 * runs at organization scope.
 */
export const RequirePermission = (
  permission: Permission,
  scope: ScopeResolver = () => ORGANIZATION_SCOPE,
) => SetMetadata(REQUIRED_PERMISSION, { permission, scope } satisfies PermissionRequirement);

export const departmentFromParam =
  (param = 'departmentId'): ScopeResolver =>
  (request) => {
    const id = request.params?.[param];
    return id ? { type: 'department', id } : undefined;
  };

export const teamFromParam =
  (param = 'teamId'): ScopeResolver =>
  (request) => {
    const id = request.params?.[param];
    return id ? { type: 'team', id } : undefined;
  };

/**
 * Global guard, deny by default: a route is reachable only if it is marked @Public(),
 * @Authenticated() with a signed-in member, or declares @RequirePermission() and the member
 * holds that permission at the resolved scope.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_CONTEXT) private readonly access: AccessContextSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ROUTE, targets)) {
      if (!request.member) throw new UnauthorizedException();
      return true;
    }

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (!requirement) {
      throw new ForbiddenException('Route declares no access policy');
    }
    if (!request.member) throw new UnauthorizedException();

    const scope = requirement.scope(request);
    if (!scope) throw new ForbiddenException();

    const access = await this.access.load(request.member.id);
    const allowed = can(
      access.assignments,
      access.rolePermissions,
      requirement.permission,
      scope,
      access.directory,
    );
    if (!allowed) throw new ForbiddenException();
    return true;
  }
}
