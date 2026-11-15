import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './http/error-handler.js';
import { sessionMiddleware } from './http/session.js';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import walletRoutes from './routes/wallet.js';
import catalogRoutes from './routes/catalog.js';
import adminRoutes from './routes/admin.js';
import drawsRoutes from './routes/draws.js';
import adminGameRoutes from './routes/admin-game.js';
import dailyRewardsRoutes from './routes/daily-rewards.js';
import profilesRoutes from './routes/profiles.js';
import invocationRoutes from './routes/invocation.js';
import invocationAdminRoutes from './routes/invocation-admin.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: config.APP_ORIGIN,
  credentials: true
}));
app.use((request, _response, next) => {
  const origin = request.get('origin');
  if (origin && origin !== config.APP_ORIGIN && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    _response.status(403).json({ error: 'Origem da solicitação não permitida.' });
    return;
  }
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(sessionMiddleware);

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }
});
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/catalog', catalogRoutes);
const drawLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitos sorteios em pouco tempo. Aguarde um momento.' }
});
app.use('/api/draws', (request, response, next) => {
  if (request.method === 'POST') return drawLimiter(request, response, next);
  next();
});
app.use('/api/draws', drawsRoutes);
app.use('/api/invocation', invocationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminGameRoutes);
app.use('/api/admin/invocation', invocationAdminRoutes);
const dailyRewardLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de recompensa. Aguarde um momento.' }
});
app.use('/api/daily-rewards', (request, response, next) => {
  if (
    request.method === 'POST'
    && request.path === '/claim'
    && request.user?.role !== 'admin'
  ) {
    return dailyRewardLimiter(request, response, next);
  }
  next();
});
app.use('/api/daily-rewards', dailyRewardsRoutes);
app.use('/api/profiles', profilesRoutes);
app.use('/uploads', express.static(fileURLToPath(new URL('../uploads/', import.meta.url)), {
  fallthrough: false,
  index: false,
  dotfiles: 'deny',
  maxAge: '1y',
  immutable: true
}));

app.use((_request, response) => {
  response.status(404).json({ error: 'Rota não encontrada.' });
});
app.use(errorHandler);
