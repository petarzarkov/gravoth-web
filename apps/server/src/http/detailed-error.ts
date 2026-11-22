import { Logger } from '@dunx/core';
import {
  ErrorFilter,
  HttpError,
  errorMapper,
  type ErrorMapper,
} from '@dunx/http';

/**
 * An `HttpError` whose body carries more than `{ error, status }`: the realm's conflicts answer what the game needs to
 * recover (`REALM_LEASED` with `leaseUntil`, `REVISION_MISMATCH` with `revision`, `ALREADY_TRANSFERRED` with
 * `characterIds`). `AppErrorFilter` lays `details` over the usual body.
 */
export class DetailedHttpError extends HttpError {
  constructor(
    status: number,
    message: string,
    readonly details: Readonly<Record<string, unknown>>,
  ) {
    super(status, message);
  }
}

/** dunx's own error mapper (the app's logger), with a `DetailedHttpError`'s details in its body. */
export class AppErrorFilter extends ErrorFilter {
  private readonly fallback: ErrorMapper;

  constructor(logger: Logger) {
    super();
    this.fallback = errorMapper(logger);
  }

  catch(error: unknown, req: Request): Response {
    if (error instanceof DetailedHttpError)
      return Response.json(
        { ...error.details, error: error.message, status: error.status },
        {
          status: error.status,
          ...(error.headers === undefined ? {} : { headers: error.headers }),
        },
      );
    return this.fallback(error, req);
  }
}
