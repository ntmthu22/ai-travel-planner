import type { Request, Response } from "express";
import { ProblemError } from "./problem.js";
import { verifyPassword, type Store } from "./store.js";

const unauthenticated = (detail: string) =>
  new ProblemError(401, "unauthenticated", "Authentication required", detail);

/**
 * The caller, from the session. `Authorization: Bearer <token>` is the real sign-in. `X-User-Id` is a
 * development stub that the deployment turns off (devAuth = false).
 */
export function authenticate(req: Request, store: Store, devAuth: boolean): string {
  const auth = req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const userId = store.userOfToken(auth.slice(7).trim());
    if (userId) return userId;
    throw unauthenticated("Invalid or expired token.");
  }
  const dev = req.header("X-User-Id");
  if (devAuth && dev) return dev;
  throw unauthenticated(devAuth ? "Missing X-User-Id." : "Missing bearer token.");
}

/** POST /auth/login {username, password} -> {token, userId}. Same answer for an unknown user and a wrong password. */
export function loginHandler(store: Store) {
  return (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      throw new ProblemError(
        400,
        "validation-error",
        "Request validation failed",
        "username and password are required.",
      );
    }
    const user = store.users.get(body.username);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw new ProblemError(
        401,
        "invalid-credentials",
        "Invalid credentials",
        "Wrong username or password.",
      );
    }
    res.status(200).json({ token: store.createSession(user.id), userId: user.id });
  };
}
