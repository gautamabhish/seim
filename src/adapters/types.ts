/**
 * Framework-agnostic adapter interface.
 *
 * Each supported framework (Express, Fastify, generic HTTP) implements this
 * interface so the core optimization pipeline never touches framework internals
 * directly.
 */
export interface RouteHandlerInfo {
  route: any;
  index: number;
  handle: Function;
  source: string;
}

export interface ResponseInfo {
  statusCode: number;
  duration: number;
  responseSize: number;
  payloadSize: number;
  error: boolean;
  timeout: boolean;
}

export interface FrameworkAdapter {
  /** Unique name for this adapter (e.g. 'express', 'fastify', 'http'). */
  readonly name: string;

  /**
   * Create a middleware/hook that instruments a route.
   * Returns a framework-native middleware (e.g. Express RequestHandler).
   */
  createMiddleware(onRequest: OnRequestCallback, onResponse: OnResponseCallback): any;

  /**
   * Given a request, extract the route handler info (function reference + source code).
   */
  getRouteHandler(req: any): RouteHandlerInfo | undefined;

  /**
   * Hot-swap the handler on a route without restarting the server.
   */
  swapHandler(routeInfo: RouteHandlerInfo, newHandler: Function): void;

  /**
   * Derive a stable route key from the request (e.g. "/api/users/:id" not "/api/users/42").
   */
  getRouteKey(req: any): string;
}

export type OnRequestCallback = (req: any, res: any, routeKey: string) => void;
export type OnResponseCallback = (req: any, res: any, routeKey: string, info: ResponseInfo) => void | Promise<void>;
