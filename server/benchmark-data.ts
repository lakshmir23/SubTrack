/** Synthetic benchmark metadata only. No private records, .env or network services. */
export const BENCHMARK_BUSINESS_DATE = '2026-11-09';
export const BENCHMARK_INSTANT = '2026-11-09T04:00:00.000Z';
export interface BenchmarkAccount { id: string; email: string; password: string }
export interface BenchmarkManifest {
  version: 1; databasePath: string; createdAt: string; businessDate: string; instant: string; schemaVersion: number;
  counts: { customers: number; subscriptions: number; invoices: number; invoiceLines: number; payments: number; logicalCharges: number; lifecycleEvents: number; discountApplications: number };
  groups: { stages: Record<string, number>; serviceStates: Record<string, number>; cadences: Record<string, number>; invoiceStatuses: Record<string, number>; chargeOutcomes: Record<string, number> };
  totals: { billed: string; received: string; outstanding: string; overdue: string };
  accounts: { admin: BenchmarkAccount; staff: BenchmarkAccount; customer: BenchmarkAccount; otherCustomer: BenchmarkAccount };
  samples: {
    productId: string; variantId: string; addonProductId: string; planId: string; taxId: string; templateId: string; discountId: string;
    plans: Record<'daily' | 'weekly' | 'monthly' | 'yearly', string>;
    subscriptions: Record<'draft' | 'quotation' | 'confirmed' | 'future' | 'running' | 'paused' | 'closed' | 'earlyClosed' | 'termEnded' | 'due' | 'failed' | 'customerOwn', string>;
    invoices: Record<'draft' | 'confirmed' | 'partial' | 'paid' | 'canceled' | 'zero' | 'customerOwn', string>;
    billingRunId: string; resetToken: string;
  };
  validation: { passed: boolean; checks: string[]; errors: string[]; checkedSubscriptions: number; checkedInvoices: number; checkedPayments: number };
}

// buildBenchmarkFixture(databasePath) in benchmark-fixture.ts requires a NEW file path,
// writes databasePath+'.manifest.json', closes all seed connections, returns this manifest.
// Runtime must use the manifest instant (Asia/Kolkata business date November 9), an
// outbox-only app and a visible synthetic environment label. Generator never reads .env.
