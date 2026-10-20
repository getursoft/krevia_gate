'use client';

import { createApiClient } from '@krevia/shared';

/** Browser API client. Same-origin (`/api/v1` is proxied by Next.js); auth via httpOnly cookie. */
export const api = createApiClient({ baseUrl: '', clientType: 'WEB' });
