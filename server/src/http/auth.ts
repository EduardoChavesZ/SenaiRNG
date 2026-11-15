import type { RequestHandler } from 'express';
import { AppError } from '../errors.js';

export const requireAuth: RequestHandler = (request, _response, next) => {
  if (!request.user) {
    next(new AppError('É necessário entrar na sua conta.', 401));
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (request, _response, next) => {
  if (!request.user) {
    next(new AppError('É necessário entrar na sua conta.', 401));
    return;
  }
  if (request.user.role !== 'admin') {
    next(new AppError('Acesso restrito a administradores.', 403));
    return;
  }
  next();
};
