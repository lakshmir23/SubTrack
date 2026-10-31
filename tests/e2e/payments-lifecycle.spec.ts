import { test, expect } from "./test";
import type { APIRequestContext, Page } from "@playwright/test";
import type { Product, Plan } from "../../shared/catalog";
import type { Subscription } from "../../shared/subscriptions";
import type { Invoice } from "../../shared/billing";
import type { PaymentInput, PaymentResult } from "../../shared/payments";
import type { LifecycleState } from "../../shared/lifecycle";
import { addDays, periodBoundary } from "../../server/calendar";

async function admin(api: APIRequestContext) {
  expect(
    (
      await api.post("/api/auth/login", {
        data: { email: "admin@brightloop.test", password: "Brightloop!2026" },
      })
    ).status(),
  ).toBe(200);
}
async function write<T>(
  api: APIRequestContext,
  path: string,
  data: unknown,
): Promise<T> {
  const session = await (await api.get("/api/session")).json();
  const response = await api.post(path, {
    data,
    headers: { "X-CSRF-Token": session.csrfToken },
  });
  if (!response.ok())
    throw new Error(
      `Synthetic payment/service fixture failed (${response.status()}) at ${path}.`,
    );
  return response.json() as Promise<T>;
}
async function login(page: Page, email = "admin@brightloop.test") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Brightloop!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Database connected", { exact: true }),
  ).toBeVisible();
}
async function offering(
  api: APIRequestContext,
  prefix: string,
  interval: "daily" | "monthly" = "monthly",
  capabilities = true,
  withAddon = false,
) {
  await admin(api);
  const { businessDate } = (await (await api.get("/api/workspace")).json()) as {
    businessDate: string;
  };
  const people = (await (await api.get("/api/customers?pageSize=100")).json())
    .items as { id: string; name: string; email: string }[];
  const product = await write<Product>(api, "/api/products", {
    name: `${prefix} Software`,
    type: "software",
    salesPrice: 120000,
    costPrice: 40000,
    notes: "Private P6 product note.",
    active: true,
    variants: [{ name: "Odoo", adjustment: 56000, active: true }],
  });
  const plan = await write<Plan>(api, "/api/plans", {
    name: `${prefix} ${interval}`,
    primaryProductId: product.id,
    price: 100000,
    interval,
    minQuantity: 1,
    availableFrom: null,
    availableTo: null,
    autoClose: capabilities,
    allowPause: capabilities,
    allowRenew: capabilities,
    allowEarlyClose: capabilities,
    active: true,
  });
  await write(api, "/api/taxes", {
    name: `${prefix} Demo 10%`,
    rateBps: 1000,
    productId: product.id,
    priority: 0,
    active: true,
  });
  const addon = withAddon
    ? await write<Product>(api, "/api/products", {
        name: `${prefix} Support`,
        type: "addon",
        salesPrice: 20000,
        costPrice: 5000,
        notes: "",
        active: true,
        variants: [],
      })
    : null;
  return {
    businessDate,
    product,
    plan,
    addon,
    maya: people.find((person) => person.email === "maya@brightloop.test")!,
    arun: people.find((person) => person.email === "arun@brightloop.test")!,
  };
}
async function active(
  api: APIRequestContext,
  fixture: Awaited<ReturnType<typeof offering>>,
  customerId: string,
  date = fixture.businessDate,
  quantity = 1,
  variant = false,
) {
  let sub = await write<Subscription>(api, "/api/subscriptions", {
    customerId,
    planId: fixture.plan.id,
    templateId: null,
    startDate: date,
    termPeriods: 5,
    paymentTermDays: 7,
    validDays: 7,
    lines: [
      {
        productId: fixture.product.id,
        variantId: variant ? fixture.product.variants[0].id : null,
        quantity,
      },
      ...(fixture.addon
        ? [{ productId: fixture.addon.id, variantId: null, quantity: 1 }]
        : []),
    ],
    idempotencyKey: crypto.randomUUID(),
  });
  for (const action of ["issue", "confirm", "activate"])
    sub = await write<Subscription>(
      api,
      `/api/subscriptions/${sub.id}/${action}`,
      { version: sub.version },
    );
  return sub;
}
async function serviceState(api: APIRequestContext, id: string) {
  return (await (
    await api.get(`/api/subscriptions/${id}/lifecycle`)
  ).json()) as LifecycleState;
}
async function serviceAction(page: Page, action: string, label: string) {
  await page.getByLabel("Service action", { exact: true }).selectOption(action);
  await page
    .getByRole("button", { name: "Review service change", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: `${label}?`, exact: true });
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function generate(page: Page, sub: Subscription, amount: string) {
  await page.goto(`/subscriptions/${sub.id}`);
  await page
    .getByRole("link", { name: "Generate next invoice", exact: true })
    .click();
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    amount,
  );
  await page
    .getByRole("button", { name: "Generate draft invoice", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Generate this draft invoice?", exact: true })
    .getByRole("button", { name: "Generate draft invoice", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
}

test("partial payment remains Confirmed, final settlement is Paid and lost-response replay cannot duplicate money", async ({
  page,
  request: api,
}) => {
  const fixture = await offering(api, "P6 Payments");
  const sub = await active(
    api,
    fixture,
    fixture.maya.id,
    fixture.businessDate,
    2,
    true,
  );
  await write(api, "/api/discounts", {
    name: "P6 Targeted launch",
    kind: "percentage",
    amountMinor: null,
    percentBps: 1000,
    minAmount: null,
    minQuantity: null,
    startDate: null,
    endDate: null,
    maxUses: 1,
    priority: 0,
    active: true,
    scope: "subscription",
    subscriptionId: sub.id,
    productIds: [],
  });
  let invoice = await write<Invoice>(
    api,
    `/api/subscriptions/${sub.id}/invoices`,
    {
      expectedPeriodStart: fixture.businessDate,
      idempotencyKey: crypto.randomUUID(),
    },
  );
  expect(invoice.total).toBe(308880);
  invoice = await write<Invoice>(api, `/api/invoices/${invoice.id}/confirm`, {
    version: invoice.version,
  });
  await login(page);
  await page.goto(`/billing/invoices/${invoice.id}`);
  await page.getByRole("link", { name: "Record payment", exact: true }).click();
  await page
    .getByLabel("Internal payment note", { exact: true })
    .fill("P6 private reconciliation note");
  await page.getByLabel("Payment method", { exact: true }).selectOption("cash");
  await page.getByLabel("Payment amount (INR)", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    page.getByLabel("Payment amount (INR)", { exact: true }),
  ).toBeFocused();
  await page.getByLabel("Payment amount (INR)", { exact: true }).fill("4000");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(page.getByText(/current outstanding balance/)).toBeVisible();
  await page
    .getByLabel("Payment amount (INR)", { exact: true })
    .fill("1000.00");
  await page
    .getByLabel("Payment date", { exact: true })
    .fill(addDays(fixture.businessDate, 1));
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(page.getByLabel("Payment date", { exact: true })).toBeFocused();
  await expect(
    page.getByLabel("Internal payment note", { exact: true }),
  ).toHaveValue("P6 private reconciliation note");
  await page
    .getByLabel("Payment date", { exact: true })
    .fill(fixture.businessDate);
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Record this payment?",
    exact: true,
  });
  await expect(
    review.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await expect(review).toContainText("Cash");
  await expect(review).toContainText("P6 private reconciliation note");
  let original: PaymentInput | undefined;
  await page.route("**/api/invoices/*/payments", async (route) => {
    if (route.request().method() === "POST" && !original) {
      original = route.request().postDataJSON() as PaymentInput;
      expect((await route.fetch()).status()).toBe(201);
      await route.abort();
    } else await route.continue();
  });
  await review
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(review.getByRole("alert")).toContainText("may have completed");
  await page.unroute("**/api/invoices/*/payments");
  await review
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Confirmed");
  await expect(
    page.getByText("Partially paid · balance outstanding", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel invoice", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await api.get(`/api/invoices/${invoice.id}`)).json()).outstanding,
  ).toBe(208880);
  await expect(
    page.getByRole("region", { name: "Payment history" }),
  ).toContainText("₹1,000.00");
  await page.getByRole("link", { name: "Record payment", exact: true }).click();
  await page
    .getByLabel("Payment amount (INR)", { exact: true })
    .fill("2088.80");
  await page
    .getByLabel("Payment method", { exact: true })
    .selectOption("bank_transfer");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Record this payment?", exact: true })
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Paid");
  await expect(page.locator(".payment-history-list article")).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: "Record payment", exact: true }),
  ).toHaveCount(0);
  const replay = await write<PaymentResult>(
    api,
    `/api/invoices/${invoice.id}/payments`,
    original!,
  );
  expect(replay.replayed).toBe(true);
  expect(replay.invoice.paymentCount).toBe(2);
  expect(replay.invoice.outstanding).toBe(0);
  expect(replay.invoice.amountPaid).toBe(308880);
  expect(
    await (await api.get(`/api/invoices/${invoice.id}/print`)).text(),
  ).not.toContain("P6 private reconciliation note");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, fixture.maya.email);
  await page.goto(`/billing/invoices/${invoice.id}`);
  await expect(page.locator(".payment-history-list article")).toHaveCount(2);
  await expect(
    page.getByText("P6 private reconciliation note", { exact: true }),
  ).toHaveCount(0);
  const portal = (
    await (
      await page.request.get(`/api/invoices/${invoice.id}/payments`)
    ).json()
  ).items;
  expect(
    portal.every((item: Record<string, unknown>) => !("note" in item)),
  ).toBe(true);
  await page.goto(`/billing/invoices/${invoice.id}/payments/new`);
  await expect(
    page.getByRole("heading", {
      name: "This area is restricted.",
      exact: true,
    }),
  ).toBeVisible();
});

test("a concurrent payment rejects a stale amount while preserving the reviewed form for correction", async ({
  page,
  request: api,
}) => {
  const fixture = await offering(api, "P6 Concurrent");
  const sub = await active(api, fixture, fixture.arun.id);
  let invoice = await write<Invoice>(
    api,
    `/api/subscriptions/${sub.id}/invoices`,
    {
      expectedPeriodStart: fixture.businessDate,
      idempotencyKey: crypto.randomUUID(),
    },
  );
  invoice = await write<Invoice>(api, `/api/invoices/${invoice.id}/confirm`, {
    version: invoice.version,
  });
  await login(page);
  await page.goto(`/billing/invoices/${invoice.id}/payments/new`);
  await page
    .getByLabel("Payment amount (INR)", { exact: true })
    .fill("1000.00");
  await page
    .getByLabel("Internal payment note", { exact: true })
    .fill("Preserve this reconciliation note.");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await write(api, `/api/invoices/${invoice.id}/payments`, {
    amount: 20000,
    currency: "INR",
    method: "cash",
    paymentDate: fixture.businessDate,
    note: "Concurrent synthetic allocation.",
    idempotencyKey: crypto.randomUUID(),
  });
  const review = page.getByRole("dialog", {
    name: "Record this payment?",
    exact: true,
  });
  await review
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(review.getByRole("alert")).toContainText("900");
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByLabel("Payment amount (INR)", { exact: true }),
  ).toHaveValue("1000.00");
  await expect(
    page.getByLabel("Internal payment note", { exact: true }),
  ).toHaveValue("Preserve this reconciliation note.");
  await page.getByLabel("Payment amount (INR)", { exact: true }).fill("900.00");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await review
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Paid");
  const saved = await (await api.get(`/api/invoices/${invoice.id}`)).json();
  expect(saved.amountPaid).toBe(110000);
  expect(saved.paymentCount).toBe(2);
  expect(saved.outstanding).toBe(0);
});

test("own optional-line and pause requests show future boundaries, renewal replays once and denied plan actions stay denied", async ({
  page,
  request: api,
}) => {
  const fixture = await offering(api, "P6 Service", "monthly", true, true);
  const sub = await active(api, fixture, fixture.maya.id);
  const invoice = await write<Invoice>(
    api,
    `/api/subscriptions/${sub.id}/invoices`,
    {
      expectedPeriodStart: fixture.businessDate,
      idempotencyKey: crypto.randomUUID(),
    },
  );
  const initial = await serviceState(api, sub.id);
  const addon = initial.addons.find((item) => !item.primary)!;
  const boundary = periodBoundary(sub.startDate, "monthly", 1);
  await login(page, fixture.maya.email);
  await page.goto(`/subscriptions/${sub.id}`);
  await page.getByRole("link", { name: "Manage service", exact: true }).click();
  await page
    .getByRole("button", {
      name: `Disable optional line ${addon.productName}`,
      exact: true,
    })
    .click();
  const toggle = page.getByRole("dialog", {
    name: "Disable this optional line?",
    exact: true,
  });
  await toggle
    .getByRole("button", { name: "Save optional line change", exact: true })
    .click();
  await expect(
    page
      .getByText(`Disable effective`, { exact: false })
      .filter({ hasText: "requested" }),
  ).toBeVisible();
  let state = await serviceState(api, sub.id);
  expect(
    state.addons.find((item) => item.lineId === addon.lineId)?.nextChange
      ?.effectiveDate,
  ).toBe(boundary);
  expect(
    state.addons.find((item) => item.lineId === addon.lineId)?.enabled,
  ).toBe(true);
  expect(state.nextPeriod?.subtotal).toBe(100000);
  expect(
    (await (await api.get(`/api/invoices/${invoice.id}`)).json()).lines,
  ).toHaveLength(2);
  await serviceAction(page, "pause", "Pause service");
  state = await serviceState(api, sub.id);
  expect(state.serviceState).toBe("Running");
  expect(
    state.scheduled.some(
      (item) => item.kind === "pause" && item.effectiveDate === boundary,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Scheduled changes", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Service action", { exact: true })
    .selectOption("renew");
  await page
    .getByLabel("Additional billing periods", { exact: true })
    .fill("0");
  await page
    .getByRole("button", { name: "Review service change", exact: true })
    .click();
  await expect(
    page.getByLabel("Additional billing periods", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Additional billing periods", { exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Review service change", exact: true })
    .click();
  const renewal = page.getByRole("dialog", {
    name: "Renew term?",
    exact: true,
  });
  let committed = false;
  await page.route("**/api/subscriptions/*/renew", async (route) => {
    if (!committed) {
      expect((await route.fetch()).ok()).toBe(true);
      committed = true;
      await route.abort();
    } else await route.continue();
  });
  await renewal
    .getByRole("button", { name: "Renew term", exact: true })
    .click();
  await expect(renewal.getByRole("alert")).toContainText("may have completed");
  await page.unroute("**/api/subscriptions/*/renew");
  await renewal
    .getByRole("button", { name: "Renew term", exact: true })
    .click();
  await expect(renewal).not.toBeVisible();
  state = await serviceState(api, sub.id);
  expect(state.expiryDate).toBe(periodBoundary(sub.startDate, "monthly", 7));
  expect(state.history.filter((event) => event.kind === "renew")).toHaveLength(
    1,
  );
  await page
    .getByRole("button", {
      name: `Keep optional line enabled ${addon.productName}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: "Enable this optional line?", exact: true })
    .getByRole("button", { name: "Save optional line change", exact: true })
    .click();
  expect(
    (await serviceState(api, sub.id)).addons.find(
      (item) => item.lineId === addon.lineId,
    )?.nextChange?.enabled,
  ).toBe(true);
  await page
    .getByRole("button", {
      name: `Schedule optional line disabled ${addon.productName}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: "Disable this optional line?", exact: true })
    .getByRole("button", { name: "Save optional line change", exact: true })
    .click();
  expect(
    (await serviceState(api, sub.id)).addons.find(
      (item) => item.lineId === addon.lineId,
    )?.nextChange?.enabled,
  ).toBe(false);
  await expect(page.locator(".service-scheduled li")).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Manage service", exact: true }),
  ).toBeVisible();
  const denied = await offering(api, "P6 Restricted", "monthly", false);
  const restricted = await active(api, denied, denied.maya.id);
  const other = await active(api, denied, denied.arun.id);
  const reasons = await serviceState(api, restricted.id);
  await page.goto(`/subscriptions/${restricted.id}/service`);
  await page
    .getByText("Plan permissions and unavailable actions", { exact: true })
    .click();
  const pausePolicy = page
    .locator(".service-policy dl > div")
    .filter({ has: page.getByText("Pause service", { exact: true }) });
  await expect(pausePolicy).toBeVisible();
  await expect(pausePolicy).toContainText(reasons.deniedReasons.pause!);
  await expect(page.getByLabel("Service action", { exact: true })).toHaveCount(
    0,
  );
  expect(
    (
      await page.request.get(`/api/subscriptions/${other.id}/lifecycle`)
    ).status(),
  ).toBe(404);
  const session = await (await page.request.get("/api/session")).json();
  expect(
    (
      await page.request.post(`/api/subscriptions/${other.id}/pause`, {
        headers: { "X-CSRF-Token": session.csrfToken },
        data: { version: other.version, idempotencyKey: crypto.randomUUID() },
      })
    ).status(),
  ).toBe(404);
});

test("narrow pause preserves old debt, records an explicit paused-period waiver and resumes on the original boundary", async ({
  page,
  request: api,
}) => {
  const fixture = await offering(api, "P6 Historical", "daily");
  const sub = await active(
    api,
    fixture,
    fixture.maya.id,
    addDays(fixture.businessDate, -1),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "staff@brightloop.test");
  await page.goto(`/subscriptions/${sub.id}/service`);
  await serviceAction(page, "pause", "Pause service");
  let state = await serviceState(api, sub.id);
  expect(state.serviceState).toBe("Paused");
  await generate(page, sub, "₹1,100.00");
  await page.goto(`/billing/workbench?q=${sub.number}`);
  const dueRow = page
    .getByRole("region", { name: "Billing queue" })
    .locator("tbody tr");
  await expect(dueRow).toHaveCount(1);
  await expect(dueRow).toContainText("Non-billable period");
  await expect(
    dueRow.locator('[data-label="Active accepted base"]'),
  ).toHaveText("₹0.00");
  await page.goto(`/subscriptions/${sub.id}`);
  await page
    .getByRole("link", { name: "Generate next invoice", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Non-billable period", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".calculation-totals")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Record non-billable period", exact: true })
    .click();
  await page
    .getByRole("dialog", {
      name: "Record this non-billable period?",
      exact: true,
    })
    .getByRole("button", { name: "Record non-billable period", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: sub.number, exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Non-billable period recorded" }),
  ).toBeVisible();
  expect(
    (await (await api.get(`/api/invoices?subscriptionId=${sub.id}`)).json())
      .total,
  ).toBe(1);
  await page.getByRole("link", { name: "Manage service", exact: true }).click();
  await serviceAction(page, "resume", "Resume service");
  state = await serviceState(api, sub.id);
  expect(
    state.scheduled.some(
      (item) =>
        item.kind === "resume" &&
        item.effectiveDate === addDays(fixture.businessDate, 1),
    ),
  ).toBe(true);
  expect(state.serviceState).toBe("Paused");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const closed = await active(
    api,
    fixture,
    fixture.maya.id,
    addDays(fixture.businessDate, -2),
  );
  await page.goto(`/subscriptions/${closed.id}/service`);
  await serviceAction(page, "closeEarly", "Close early");
  expect((await serviceState(api, closed.id)).stage).toBe("Closed");
  await generate(page, closed, "₹1,100.00");
  await page.goto("/subscriptions/service-processing");
  await page.getByLabel("Agreement limit", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Review service processing", exact: true })
    .click();
  await expect(
    page.getByLabel("Agreement limit", { exact: true }),
  ).toBeFocused();
  await page.getByLabel("Agreement limit", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "Review service processing", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Process due service changes?", exact: true })
    .getByRole("button", { name: "Process service changes", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Service processing results" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
