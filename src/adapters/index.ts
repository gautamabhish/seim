export { FrameworkAdapter, RouteHandlerInfo, ResponseInfo, OnRequestCallback, OnResponseCallback } from './types';
export { ExpressAdapter } from './express';
export { FastifyAdapter } from './fastify';
export { GenericHttpAdapter } from './generic';

import { FrameworkAdapter } from './types';
import { ExpressAdapter } from './express';
import { FastifyAdapter } from './fastify';
import { GenericHttpAdapter } from './generic';

export function createAdapter(framework?: string): FrameworkAdapter {
  switch (framework) {
    case 'fastify':
      return new FastifyAdapter();
    case 'http':
    case 'generic':
      return new GenericHttpAdapter();
    case 'express':
    default:
      return new ExpressAdapter();
  }
}
