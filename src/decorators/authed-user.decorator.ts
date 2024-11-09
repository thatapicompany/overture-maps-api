import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const AuthedUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.res.locals['user']; // Get the user from locals
  },
);

//interface for user object
export interface User {
    accountId: string;
    userId: string;
    isDemoAccount?: boolean;
  }