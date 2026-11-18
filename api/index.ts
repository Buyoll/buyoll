import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { apiRouter } from '../server/api.js';
import {
  compressionMiddleware,
  createApiNotFoundOrMethodHandler,
  globalJsonErrorHandler,
  securityAndCorsMiddleware,
} from '../server/http_middleware.js';

const app = express();
app.set('trust proxy', 1);
app.use(securityAndCorsMiddleware);
app.use(compressionMiddleware);
app.use(cookieParser());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use('/api', apiRouter);
app.use('/api', createApiNotFoundOrMethodHandler(apiRouter));
app.use(globalJsonErrorHandler);

export default function handler(req: express.Request, res: express.Response) {
  try {
    return app(req, res, (err: any) => {
      if (err) {
        return globalJsonErrorHandler(err, req, res, () => {});
      }
      if (!res.headersSent) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Requested API endpoint was not found.',
          },
        });
      }
    });
  } catch (err: any) {
    return globalJsonErrorHandler(err, req, res, () => {});
  }
}
