export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string, code = "bad_request"): HttpError {
  return new HttpError(400, code, message);
}

export function notFound(message: string, code = "not_found"): HttpError {
  return new HttpError(404, code, message);
}
