import { test, expect } from "./test";
import type { APIRequestContext, Page } from "@playwright/test";
import type { Product, Plan } from "../../shared/catalog";
import type { Subscription } from "../../shared/subscriptions";
import type {
  DiscountInput,
  DiscountRule,
  Invoice,
} from "../../shared/billing";

async function loginApi(api: APIRequestContext) {
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
  method: "POST" | "PUT" = "POST",
): Promise<T> {
  const session = (await (await api.get("/api/session")).json()) as {
    csrfToken: string;
  };
  const response = await api.fetch(path, {
    method,
    headers: { "X-CSRF-Token": session.csrfToken },
    data,
  });
  if (!response.ok())
    throw new Error(
      `Synthetic billing fixture write failed at ${path} with status ${response.status()}.`,
    );
  return response.json() as Promise<T>;
}
async function login(page: Page, email = "admin@brightloop.test") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Brightloop!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: email.startsWith("maya") ? "Your workspace" : "Workspace",
      exact: true,
    }),
  ).toBeVisible();
}
async function accepted(
  api: APIRequestContext,
  customerId: string,
  plan: Plan,
  lines: { productId: string; variantId: string | null; quantity: number }[],
  date: string,
) {
  let subscription = await write<Subscription>(api, "/api/subscriptions", {
    customerId,
    planId: plan.id,
    templateId: null,
    startDate: date,
    termPeriods: 3,
    paymentTermDays: 7,
    validDays: 7,
    lines,
    idempotencyKey: crypto.randomUUID(),
  });
  for (const action of ["issue", "confirm", "activate"])
    subscription = await write<Subscription>(
      api,
      `/api/subscriptions/${subscription.id}/${action}`,
      { version: subscription.version },
    );
  return subscription;
}
async function setup(
  api: APIRequestContext,
  prefix: string,
  withAddon = false,
) {
  await loginApi(api);
  const people = (await (
    await api.get("/api/customers?pageSize=100")
  ).json()) as { items: { id: string; name: string; email: string }[] };
  const maya = people.items.find(
      (person) => person.email === "maya@brightloop.test",
    )!,
    arun = people.items.find(
      (person) => person.email === "arun@brightloop.test",
    )!;
  const { businessDate } = (await (await api.get("/api/workspace")).json()) as {
    businessDate: string;
  };
  const product = await write<Product>(api, "/api/products", {
    name: `${prefix} Business Software`,
    type: "software",
    salesPrice: 100000,
    costPrice: 40000,
    notes: "Synthetic billing internal note.",
    active: true,
    variants: [{ name: "Odoo", adjustment: 56000, active: true }],
  });
  const plan = await write<Plan>(api, "/api/plans", {
    name: `${prefix} Monthly`,
    primaryProductId: product.id,
    price: 100000,
    interval: "monthly",
    minQuantity: 1,
    availableFrom: null,
    availableTo: null,
    autoClose: true,
    allowPause: true,
    allowRenew: true,
    allowEarlyClose: true,
    active: true,
  });
  await write(api, "/api/taxes", {
    name: `${prefix} Demo 10%`,
    rateBps: 1000,
    productId: product.id,
    priority: 0,
    active: true,
  });
  let addon: Product | null = null;
  if (withAddon) {
    addon = await write<Product>(api, "/api/products", {
      name: `${prefix} Support`,
      type: "addon",
      salesPrice: 50000,
      costPrice: 10000,
      notes: "",
      active: true,
      variants: [],
    });
    await write(api, "/api/taxes", {
      name: `${prefix} Add-on 10%`,
      rateBps: 1000,
      productId: addon.id,
      priority: 0,
      active: true,
    });
  }
  const lines = [
    { productId: product.id, variantId: product.variants[0].id, quantity: 2 },
    ...(addon ? [{ productId: addon.id, variantId: null, quantity: 1 }] : []),
  ];
  const a = await accepted(api, maya.id, plan, lines, businessDate);
  const b = await accepted(
    api,
    arun.id,
    plan,
    [{ productId: product.id, variantId: null, quantity: 1 }],
    businessDate,
  );
  return { product, addon, plan, maya, arun, businessDate, a, b };
}
const blankRule: DiscountInput = {
  name: "Synthetic rule",
  kind: "percentage",
  amountMinor: null,
  percentBps: 1000,
  minAmount: null,
  minQuantity: null,
  startDate: null,
  endDate: null,
  maxUses: null,
  priority: 0,
  active: true,
  scope: "subscription",
  subscriptionId: null,
  productIds: [],
};
async function generateFromAgreement(
  page: Page,
  subscription: Subscription,
  expectedTotal: string,
) {
  await page.goto(`/subscriptions/${subscription.id}`);
  await page
    .getByRole("link", { name: "Generate next invoice", exact: true })
    .click();
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    expectedTotal,
  );
  await expect(page.locator(".calculation-totals .grand-total dt")).toHaveText(
    "Invoice total",
  );
  await page
    .getByRole("button", { name: "Generate draft invoice", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Generate this draft invoice?",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Generate draft invoice", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  return (
    await page.request.get(`/api/invoices/${id}`)
  ).json() as Promise<Invoice>;
}
async function confirmInvoice(page: Page, expected: "Confirmed" | "Paid") {
  await page
    .getByRole("button", { name: "Confirm invoice", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm invoice", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText(expected);
}

test("automatic targeted discount produces 3088.80, safely replays generation and freezes through rule changes", async ({
  page,
  request: api,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(api, "P4 Main");
  await login(page);
  await page.goto("/configuration/discounts/new");
  await page
    .getByLabel("Discount rule name", { exact: true })
    .fill("P4 Main LAUNCH10");
  await page.getByLabel("Discount percentage (%)", { exact: true }).fill("101");
  await page
    .getByRole("button", { name: "Save discount rule", exact: true })
    .click();
  await expect(
    page.getByText("Use a percentage from 0 to 100.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Discount percentage (%)", { exact: true }).fill("10");
  await page
    .getByLabel("Minimum eligible purchase (INR)", { exact: true })
    .fill("1000.00");
  await page.getByLabel("Minimum eligible quantity", { exact: true }).fill("2");
  await page
    .getByLabel("Valid from", { exact: true })
    .fill(fixture.businessDate);
  await page
    .getByLabel("Valid through", { exact: true })
    .fill(fixture.businessDate);
  await page.getByLabel("Maximum invoice uses", { exact: true }).fill("1");
  await page.getByLabel("Priority", { exact: true }).fill("0");
  await page
    .getByLabel("Subscription targeting", { exact: true })
    .selectOption("one");
  await page
    .getByLabel("Target subscription", { exact: true })
    .selectOption({ label: `${fixture.a.number} · ${fixture.maya.name}` });
  await page
    .getByRole("button", { name: "Save discount rule", exact: true })
    .click();
  await page
    .getByRole("link", { name: "P4 Main LAUNCH10", exact: true })
    .click();
  const ruleId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.goto(`/subscriptions/${fixture.a.id}`);
  await page
    .getByRole("link", { name: "Generate next invoice", exact: true })
    .click();
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹3,088.80",
  );
  await page
    .getByRole("button", { name: "Generate draft invoice", exact: true })
    .click();
  let committed = false;
  await page.route("**/api/subscriptions/*/invoices", async (route) => {
    if (route.request().method() === "POST" && !committed) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committed = true;
      await route.abort();
    } else await route.continue();
  });
  const generationDialog = page.getByRole("dialog", {
    name: "Generate this draft invoice?",
    exact: true,
  });
  await generationDialog
    .getByRole("button", { name: "Generate draft invoice", exact: true })
    .click();
  await expect(generationDialog.getByRole("alert")).toContainText(
    "may have completed",
  );
  await page.unroute("**/api/subscriptions/*/invoices");
  await generationDialog
    .getByRole("button", { name: "Generate draft invoice", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  await expect(
    page.getByText("Awaiting confirmation · not collectible", { exact: true }),
  ).toBeVisible();
  const invoiceId = new URL(page.url()).pathname.split("/").at(-1)!;
  const invoiceA = (await (
    await api.get(`/api/invoices/${invoiceId}`)
  ).json()) as Invoice;
  expect(invoiceA.total).toBe(308880);
  expect(invoiceA.discountApplicationState).toBe("reserved");
  const generated = (await (
    await api.get(`/api/invoices?subscriptionId=${fixture.a.id}`)
  ).json()) as { total: number };
  expect(generated.total).toBe(1);
  await page
    .getByRole("link", { name: "View rule usage", exact: true })
    .click();
  await expect(
    page
      .locator(".rule-usage > div")
      .filter({ has: page.getByText("Reserved", { exact: true }) })
      .locator("dd"),
  ).toHaveText("1");
  await expect(
    page.getByRole("link", { name: invoiceA.number, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Edit discount rule", exact: true })
    .click();
  await page.getByLabel("Discount percentage (%)", { exact: true }).fill("50");
  await page.getByLabel("Valid from", { exact: true }).fill("");
  await page.getByLabel("Valid through", { exact: true }).fill("2000-01-01");
  await page
    .getByRole("button", { name: "Save discount rule", exact: true })
    .click();
  await page.goto(`/billing/invoices/${invoiceA.id}`);
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹3,088.80",
  );
  await confirmInvoice(page, "Confirmed");
  const consumed = (await (
    await api.get(`/api/discounts/${ruleId}`)
  ).json()) as DiscountRule;
  expect(consumed.reserved).toBe(0);
  expect(consumed.consumed).toBe(1);
  expect(consumed.remaining).toBe(0);
  const invoiceB = await generateFromAgreement(page, fixture.b, "₹1,100.00");
  await confirmInvoice(page, "Confirmed");
  expect(invoiceA.total + invoiceB.total).toBe(418880);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, fixture.maya.email);
  await page.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(
    page.getByRole("link", { name: invoiceA.number, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: invoiceB.number, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: invoiceA.number, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm invoice", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cancel invoice", exact: true }),
  ).toHaveCount(0);
  expect(
    (await page.request.get(`/api/invoices/${invoiceB.id}`)).status(),
  ).toBe(404);
  const portal = await (
    await page.request.get(`/api/invoices/${invoiceA.id}`)
  ).json();
  expect(Object.hasOwn(portal, "discountDecisions")).toBe(false);
  expect(JSON.stringify(portal).includes("costPrice")).toBe(false);
  expect(
    JSON.stringify(portal).includes("Synthetic billing internal note."),
  ).toBe(false);
});

test("fixed product scope supports multiple products; cancellation releases the use and zero invoice settles without payment", async ({
  page,
  request: api,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(api, "P4 Fixed", true);
  await login(page);
  await page.goto("/configuration/discounts/new");
  await page
    .getByLabel("Discount rule name", { exact: true })
    .fill("P4 Fixed Support credit");
  await page.getByLabel("Discount type", { exact: true }).selectOption("fixed");
  await page
    .getByLabel("Discount amount (INR)", { exact: true })
    .fill("100.00");
  await page
    .getByLabel("Discount scope", { exact: true })
    .selectOption("products");
  await page
    .getByLabel("Add eligible product", { exact: true })
    .selectOption({ label: fixture.product.name });
  await page
    .getByLabel("Add eligible product", { exact: true })
    .selectOption({ label: fixture.addon!.name });
  await expect(page.locator(".selected-products li")).toHaveCount(2);
  await page.getByLabel("Maximum invoice uses", { exact: true }).fill("1");
  await page.getByLabel("Priority", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Save discount rule", exact: true })
    .click();
  await page
    .getByRole("link", { name: "P4 Fixed Support credit", exact: true })
    .click();
  const ruleId = new URL(page.url()).pathname.split("/").at(-1)!;
  const invoice = await generateFromAgreement(page, fixture.a, "₹3,872.00");
  await page
    .getByRole("button", { name: "Cancel invoice", exact: true })
    .click();
  const cancellation = page.getByRole("dialog", {
    name: "Cancel this invoice?",
    exact: true,
  });
  await expect(
    cancellation.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await cancellation
    .getByRole("button", { name: "Cancel invoice", exact: true })
    .click();
  await expect(
    page.getByText("Canceled · historical amount, not collectible", {
      exact: true,
    }),
  ).toBeVisible();
  const released = (await (
    await api.get(`/api/discounts/${ruleId}`)
  ).json()) as DiscountRule;
  expect(released.reserved).toBe(0);
  expect(released.consumed).toBe(0);
  expect(released.remaining).toBe(1);
  const replay = await write<Invoice>(
    api,
    `/api/subscriptions/${fixture.a.id}/invoices`,
    {
      expectedPeriodStart: fixture.businessDate,
      idempotencyKey: crypto.randomUUID(),
    },
  );
  expect(replay.id).toBe(invoice.id);
  expect(replay.status).toBe("Canceled");
  const zero = await accepted(
    api,
    fixture.maya.id,
    fixture.plan,
    [{ productId: fixture.product.id, variantId: null, quantity: 1 }],
    fixture.businessDate,
  );
  await write(api, "/api/discounts", {
    ...blankRule,
    name: "P4 Fixed Fully covered",
    percentBps: 10000,
    priority: 0,
    scope: "products",
    subscriptionId: zero.id,
    productIds: [fixture.product.id],
    maxUses: 1,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "staff@brightloop.test");
  const zeroInvoice = await generateFromAgreement(page, zero, "₹0.00");
  await confirmInvoice(page, "Paid");
  await expect(
    page.getByText("Zero amount due", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("0 payment records", { exact: true }),
  ).toBeVisible();
  const paid = (await (
    await api.get(`/api/invoices/${zeroInvoice.id}`)
  ).json()) as Invoice;
  expect(paid.status).toBe("Paid");
  expect(paid.paymentCount).toBe(0);
  expect(paid.amountPaid).toBe(0);
  expect(paid.outstanding).toBe(0);
});

test("mobile discount validation preserves input and staff configuration remains read-only", async ({
  page,
  request: api,
}) => {
  const fixture = await setup(api, "P4 Narrow");
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/configuration/discounts/new");
  await page
    .getByLabel("Discount rule name", { exact: true })
    .fill("P4 Narrow Product offer");
  await page.getByLabel("Discount percentage (%)", { exact: true }).fill("5");
  await page
    .getByLabel("Discount scope", { exact: true })
    .selectOption("products");
  await page
    .getByRole("button", { name: "Save discount rule", exact: true })
    .click();
  await expect(
    page.getByLabel("Add eligible product", { exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText("Select at least one eligible product.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Discount rule name", { exact: true }),
  ).toHaveValue("P4 Narrow Product offer");
  await page
    .getByLabel("Add eligible product", { exact: true })
    .selectOption({ label: fixture.product.name });
  await page
    .getByRole("button", { name: "Save discount rule", exact: true })
    .click();
  await page
    .getByRole("link", { name: "P4 Narrow Product offer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "P4 Narrow Product offer", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const mainNav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  await mainNav
    .getByRole("link", { name: "Billing", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Billing", exact: true }),
  ).toBeVisible();
  await mainNav
    .getByRole("link", { name: "Configuration", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Configuration", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "staff@brightloop.test");
  await page.goto("/configuration/discounts/new");
  await expect(
    page.getByRole("heading", {
      name: "This area is restricted.",
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.locator("main h1").count()).toBe(1);
  await page.goto("/configuration/discounts");
  await expect(
    page.getByRole("link", { name: "New discount rule", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "P4 Narrow Product offer", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Edit discount rule", exact: true }),
  ).toHaveCount(0);
});
