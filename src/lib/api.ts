/**
 * Minimal fetch wrapper for the FastAPI backend.
 *
 * The backend runs at http://127.0.0.1:8000 (see README). The base URL can
 * be overridden at build time with the VITE_API_URL environment variable.
 * Only public configuration lives here — no keys or secrets.
 */

export class ApiError extends Error {
  readonly status: number;
  /** Field-level validation errors from the backend (FastAPI 422 responses). */
  readonly fields: Record<string, string> | undefined;

  constructor(message: string, status: number, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

const BASE_URL = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://127.0.0.1:8000";

interface ValidationItem {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error(
      "Cannot reach the backend. Is the FastAPI server running on http://127.0.0.1:8000?",
    );
  }

  if (!response.ok) {
    const body = (await readJson(response)) as { detail?: string | ValidationItem[] } | null;
    const detail = body?.detail;

    // Plain string detail: the usual FastAPI error message.
    if (typeof detail === "string") {
      throw new ApiError(detail, response.status);
    }

    // Validation errors: an array of { loc, msg, type } items.
    if (Array.isArray(detail)) {
      const fields: Record<string, string> = {};
      let first = "";
      for (const item of detail) {
        if (!item?.msg) continue;
        const loc = item.loc ?? [];
        const key = loc.length > 0 ? String(loc[loc.length - 1]) : "";
        if (key && !fields[key]) fields[key] = item.msg;
        first = first || item.msg;
      }
      throw new ApiError(first || "Validation failed.", response.status, fields);
    }

    throw new ApiError(`Request failed (${response.status}).`, response.status);
  }

  return (await readJson(response)) as T;
}
