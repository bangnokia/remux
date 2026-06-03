import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { MetadataStore } from "./metadata.js";

const TOKEN_HASH_KEY = "auth.tokenHash";

export interface AuthState {
  authRequired: boolean;
  generatedToken: string | null;
  verifyToken(token: string | undefined | null): boolean;
}

export function initializeAuth(store: MetadataStore, configuredToken: string | null): AuthState {
  const token = configuredToken?.trim() ?? "";

  if (!token) {
    store.deleteString(TOKEN_HASH_KEY);
    return {
      authRequired: false,
      generatedToken: null,
      verifyToken() {
        return true;
      }
    };
  }

  store.setString(TOKEN_HASH_KEY, hashToken(token));

  return {
    authRequired: true,
    generatedToken: null,
    verifyToken(token) {
      const tokenHash = store.getString(TOKEN_HASH_KEY);
      if (!token || !tokenHash) {
        return false;
      }

      return secureEqual(hashToken(token), tokenHash);
    }
  };
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthState
): Promise<boolean> {
  const token = readBearerToken(request.headers.authorization);
  if (auth.verifyToken(token)) {
    return true;
  }

  await reply.code(401).send({
    error: {
      code: "unauthorized",
      message: "Missing or invalid bearer token"
    }
  });
  return false;
}

export function readBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(`telemux:v1:${token}`).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
