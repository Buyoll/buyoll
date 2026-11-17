import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { apiRouter } from '../server/api.js';
import {
  createApiNotFoundOrMethodHandler,
  globalJsonErrorHandler,
  securityAndCorsMiddleware,
} from '../server/http_middleware.js';

const app = express();
app.set('trust proxy', 1);
app.use(securityAndCorsMiddleware);
app.use(cookieParser());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use('/api', apiRouter);
app.use('/api', createApiNotFoundOrMethodHandler(apiRouter));
app.use(globalJsonErrorHandler);

export default app;
