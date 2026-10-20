import { createApiClient } from '@krevia/shared';
import { API_URL } from './config';

let currentToken: string | null = null;
let unauthenticatedHandler: (() => void) | null = null;

export function setApiToken(token: string | null) {
  currentToken = token;
}

export function onApiUnauthenticated(handler: (() => void) | null) {
  unauthenticatedHandler = handler;
}

/** Mobile API client: bearer token auth, same contract and validation as the website. */
export const api = createApiClient({
  baseUrl: API_URL,
  clientType: 'MOBILE',
  getToken: () => currentToken,
  onUnauthenticated: () => unauthenticatedHandler?.(),
});

export type MobileApi = typeof api;
