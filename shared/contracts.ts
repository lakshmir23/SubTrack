export const roles = ['admin', 'staff', 'customer'] as const;
export type Role = typeof roles[number];
export interface User { id: string; name: string; email: string; role: Role; createdAt: string }
export interface SessionResponse { user: User | null; csrfToken: string | null }
export interface ApiError { error: { code: string; message: string; fields?: Record<string, string>; requestId: string } }
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface WorkspaceSummary {
  organization: string; businessDate: string; timezone: string; currency: string;
  customers: number; staff: number; database: string; mailMode: 'outbox' | 'smtp';
  implementationGate: 'P1';
}
export interface Delivery {
  id: string; recipient: string; subject: string; createdAt: string;
  status: 'generated' | 'sending' | 'accepted' | 'failed' | 'unknown'; error: string | null;
}
// Business dates: YYYY-MM-DD in Asia/Kolkata. Instants: ISO-8601 UTC.
// Money: safe integer INR minor units; authoritative arithmetic stays on server.
export type BusinessDate = string & { readonly __type: 'BusinessDate' };
export type MinorUnits = number & { readonly __type: 'MinorUnits' };
