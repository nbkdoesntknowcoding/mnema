import { WorkOS } from '@workos-inc/node';
import { config } from '../config/env.js';

export const workos = new WorkOS(config.WORKOS_API_KEY, {
  clientId: config.WORKOS_CLIENT_ID,
});
