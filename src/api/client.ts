import crypto from 'node:crypto';
import { BASE_URL } from './endpoints.js';
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
} from './types.js';
import { withRetry } from '../utils/retry.js';

export interface ClientOptions {
  verbose?: boolean;
}

const BROWSER_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://chatgpt.com/',
  'Origin': 'https://chatgpt.com',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

export class ChatGPTClient {
  private accessToken: string;
  private verbose: boolean;
  private deviceId: string;

  constructor(accessToken: string, options: ClientOptions = {}) {
    this.accessToken = accessToken;
    this.verbose = options.verbose ?? false;
    this.deviceId = crypto.randomUUID();
  }

  private getHeaders(): Record<string, string> {
    return {
      ...BROWSER_HEADERS,
      Authorization: `Bearer ${this.accessToken}`,
      'Oai-Device-Id': this.deviceId,
      'Oai-Language': 'en-US',
    };
  }

  async initialize(): Promise<void> {
    const response = await fetch(`${BASE_URL}/backend-api/conversations?offset=0&limit=1`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      if (this.verbose) {
        console.error(`Auth check failed: HTTP ${response.status}`);
        console.error(`Response body: ${body.slice(0, 500)}`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(
          `Access token rejected (HTTP ${response.status}). ${this.verbose ? '' : 'Re-run with --verbose to see the full response.'}`
        );
      }
      throw new NetworkError(`Failed to verify token: ${response.status}`, response.status);
    }

    if (this.verbose) {
      console.log('Successfully authenticated');
    }
  }

  async fetch<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: unknown;
      parseResponse?: (data: unknown) => T;
    } = {}
  ): Promise<T> {
    if (!this.accessToken) {
      throw new AuthenticationError('Client not initialized. Call initialize() first.');
    }

    const { method = 'GET', body, parseResponse } = options;

    return withRetry(
      async () => {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
          method,
          headers: this.getHeaders(),
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new AuthenticationError('Access token expired or invalid.');
          }

          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            throw new RateLimitError(
              'Rate limited by API',
              retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
            );
          }

          throw new NetworkError(
            `Request failed: ${response.status} ${response.statusText}`,
            response.status
          );
        }

        const data = await response.json();
        return parseResponse ? parseResponse(data) : (data as T);
      },
      {
        onRetry: (error, attempt, delay) => {
          if (this.verbose) {
            console.log(`Retry ${attempt}: ${error.message} (waiting ${Math.round(delay / 1000)}s)`);
          }
        },
      }
    );
  }
}
