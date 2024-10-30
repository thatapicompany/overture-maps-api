import { CanActivate, ExecutionContext, HttpException, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express'

export class IsAuthenticatedGuard implements CanActivate {

  canActivate(context: ExecutionContext) {
    //console.log("test")
    const request:Request = context.switchToHttp().getRequest();
    const  user  = request['user'] || request.res.locals.user;
    //console.log("u",user)

    //Logger.debug("IsAuthenticatedGuard", JSON.stringify(user))
    //throw new UnauthorizedException();
   if(!user) throw new HttpException("Unauthorized - pass your API Key as the api-key header on the request", HttpStatus.UNAUTHORIZED)
    return !!user;
  }

}