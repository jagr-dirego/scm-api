import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { RequestContextService } from './request-context.service';
import { resolveRequestId } from './request-id';

interface RequestWithId {
  id?: string;
  method?: string;
  url?: string;
}

interface HttpReply {
  header(name: string, value: string): unknown;
  status(statusCode: number): HttpReply;
  send(payload: unknown): unknown;
}

interface PublicErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
}

const statusCodes: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(
    @Inject(RequestContextService)
    private readonly requestContext: RequestContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const reply = http.getResponse<HttpReply>();
    const requestId =
      this.requestContext.getRequestId() ?? resolveRequestId(request.id);
    const response = this.toPublicResponse(exception, requestId);

    void reply.header('x-request-id', requestId);
    void reply.status(response.statusCode).send(response);

    if (response.statusCode >= 500) {
      this.logger.error({
        event: 'http.request.failed',
        statusCode: response.statusCode,
        code: response.code,
        method: request.method,
        path: request.url?.split('?', 1)[0],
        exceptionType:
          exception instanceof Error ? exception.constructor.name : 'Unknown',
      });
    }
  }

  private toPublicResponse(
    exception: unknown,
    requestId: string,
  ): PublicErrorResponse {
    if (!(exception instanceof HttpException)) {
      return this.internalError(requestId);
    }

    const statusCode = exception.getStatus();
    const raw = exception.getResponse();
    if (statusCode >= 500 && typeof raw === 'string') {
      return this.serverError(statusCode, requestId);
    }
    const source = typeof raw === 'object' && raw !== null ? raw : {};
    const explicitCode = this.readString(source, 'code');
    if (statusCode >= 500 && !explicitCode) {
      return this.serverError(statusCode, requestId);
    }
    const code = explicitCode ?? statusCodes[statusCode] ?? 'HTTP_ERROR';
    const message =
      this.readString(source, 'message') ??
      (statusCode >= 500
        ? 'Ocurrio un error interno'
        : this.defaultMessage(statusCode));

    return { statusCode, code, message, requestId };
  }

  private internalError(requestId: string): PublicErrorResponse {
    return this.serverError(HttpStatus.INTERNAL_SERVER_ERROR, requestId);
  }

  private serverError(
    statusCode: number,
    requestId: string,
  ): PublicErrorResponse {
    return {
      statusCode,
      code: statusCodes[statusCode] ?? 'INTERNAL_SERVER_ERROR',
      message: 'Ocurrio un error interno',
      requestId,
    };
  }

  private readString(source: object, key: string): string | undefined {
    const value = (source as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  private defaultMessage(statusCode: number): string {
    if (statusCode === 400) return 'Solicitud invalida';
    if (statusCode === 401) return 'No autenticado';
    if (statusCode === 403) return 'Acceso denegado';
    if (statusCode === 404) return 'Recurso no encontrado';
    if (statusCode >= 500) return 'Ocurrio un error interno';
    return 'No fue posible completar la solicitud';
  }
}
