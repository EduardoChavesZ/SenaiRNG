import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../errors.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Dados inválidos.', details: error.flatten().fieldErrors });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    response.status(status).json({
      error: status === 413 ? 'A imagem excede o tamanho máximo permitido.' : 'Não foi possível processar o arquivo enviado.'
    });
    return;
  }

  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  if (code === '23505') {
    response.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
    return;
  }

  console.error('Unhandled request error', error);
  response.status(500).json({ error: 'Não foi possível concluir a solicitação.' });
};
