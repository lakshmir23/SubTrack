import type { ApiError } from "../shared/contracts";

let csrfToken: string | null = null;
export function setCsrfToken(value: string | null) {
  csrfToken = value;
}

export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  constructor(status: number, payload?: ApiError) {
    super(
      payload?.error.message ||
        "The request could not be completed. Please retry.",
    );
    this.status = status;
    this.code = payload?.error.code || "REQUEST_FAILED";
    this.fields = payload?.error.fields || {};
  }
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event("subtrack:session-expired"));
      throw new RequestError(response.status, payload as ApiError);
    }
    return payload as T;
  } catch (error) {
    const mutation = options.method && options.method !== "GET";
    if (timedOut)
      throw new Error(
        mutation
          ? "The response took too long. Your entries are still here, but this action may have completed. Check the result before trying again."
          : "The server took too long to respond. Please retry.",
        { cause: error },
      );
    if (
      error instanceof RequestError ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw error;
    throw new Error(
      mutation
        ? "The connection was interrupted. Your entries are still here, but this action may have completed. Check the result before trying again."
        : "The server could not be reached. Check your connection, then retry.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be completed. Please retry.";
}
