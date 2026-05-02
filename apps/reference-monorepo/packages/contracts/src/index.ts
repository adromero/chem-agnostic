// Generated OpenAPI contract types — placeholder. In a real repo this file
// would be emitted by `openapi-typescript` against the FastAPI spec.

export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string };
}
