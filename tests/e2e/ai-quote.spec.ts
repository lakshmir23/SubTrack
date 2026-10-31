import { test, expect } from "./test";
import type { APIRequestContext, Page } from "@playwright/test";
import type { Plan, Product } from "../../shared/catalog";
import { formatMoney } from "../../shared/money";

// The isolated test server injects a deterministic provider; these tests never
// read .env, use a real key or contact an external model.
async function login(page: Page, email = "staff@brightloop.test") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Brightloop!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Database connected", { exact: true }),
  ).toBeVisible();
}
async function write<T>(
  api: APIRequestContext,
  path: string,
  data: unknown,
  method = "POST",
): Promise<T> {
  const session = await (await api.get("/api/session")).json();
  const response = await api.fetch(path, {
    method,
    data,
    headers: { "X-CSRF-Token": session.csrfToken },
  });
  if (!response.ok())
    throw new Error(
      `Synthetic AI fixture failed (${response.status()}) at ${path}.`,
    );
  return response.json() as Promise<T>;
}
async function fixture(api: APIRequestContext) {
  expect(
    (
      await api.post("/api/auth/login", {
        data: { email: "admin@brightloop.test", password: "Brightloop!2026" },
      })
    ).ok(),
  ).toBe(true);
  const customers = (
    await (await api.get("/api/customers?pageSize=100")).json()
  ).items as { id: string; email: string }[];
  let product = (
    await (
      await api.get("/api/products?q=AA%20AI%20Software&pageSize=100")
    ).json()
  ).items[0] as Product | undefined;
  if (!product) {
    product = await write<Product>(api, "/api/products", {
      name: "AA AI Software",
      type: "software",
      salesPrice: 100000,
      costPrice: 30000,
      notes: "Synthetic private note, excluded from model context.",
      active: true,
      variants: [{ name: "Odoo", adjustment: 56000, active: true }],
    });
    await write(api, "/api/taxes", {
      name: "AA AI demo tax",
      rateBps: 1000,
      productId: product.id,
      priority: 0,
      active: true,
    });
  }
  let plan = (
    await (await api.get("/api/plans?q=AA%20AI%20Monthly&pageSize=100")).json()
  ).items[0] as Plan | undefined;
  if (!plan)
    plan = await write<Plan>(api, "/api/plans", {
      name: "AA AI Monthly",
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
  return {
    product,
    plan,
    maya: customers.find(
      (customer) => customer.email === "maya@brightloop.test",
    )!,
    arun: customers.find(
      (customer) => customer.email === "arun@brightloop.test",
    )!,
  };
}
async function newDraft(page: Page, customerId: string) {
  await page.goto("/subscriptions/new");
  await expect(page.getByLabel("Customer", { exact: true })).toBeEnabled();
  await page.getByLabel("Customer", { exact: true }).selectOption(customerId);
  await page.getByLabel("Payment terms (days)", { exact: true }).fill("17");
  await page.locator(".quote-assist > summary").click();
  await expect(
    page.getByRole("button", { name: "Suggest selections", exact: true }),
  ).toBeEnabled();
}
async function suggest(
  page: Page,
  request = "Two Odoo software units monthly starting 1 November 2026",
) {
  await page.getByLabel("Describe the offering", { exact: true }).fill(request);
  await page
    .getByRole("button", { name: "Suggest selections", exact: true })
    .click();
}
async function apply(page: Page) {
  await expect(
    page.getByRole("region", { name: "Suggested offering", exact: true }),
  ).toContainText("2 × AA AI Software");
  await page
    .getByRole("button", { name: "Apply suggested fields", exact: true })
    .click();
  await expect(
    page.getByLabel("I reviewed the current calculated estimate", {
      exact: true,
    }),
  ).toBeEnabled();
}

test("AI suggestion requires apply and exact price review; response-loss retry saves one ordinary Draft", async ({
  page,
  request: api,
}) => {
  const data = await fixture(api);
  const before = (
    await (
      await api.get(`/api/subscriptions?customerId=${data.maya.id}`)
    ).json()
  ).total;
  await login(page);
  await newDraft(page, data.maya.id);
  await page
    .getByLabel("Service start date", { exact: true })
    .fill("2026-11-02");
  let calls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/ai/quote-proposals")) calls++;
  });
  await page
    .getByLabel("Describe the offering", { exact: true })
    .fill("Two Odoo units monthly starting 1 November 2026");
  await page
    .getByRole("button", { name: "Suggest selections", exact: true })
    .dblclick();
  await expect(
    page.getByRole("region", { name: "Suggested offering", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await expect(
    page.getByLabel("Service start date", { exact: true }),
  ).toHaveValue("2026-11-02");
  expect(
    (
      await (
        await api.get(`/api/subscriptions?customerId=${data.maya.id}`)
      ).json()
    ).total,
  ).toBe(before);
  await apply(page);
  await expect(
    page.getByLabel("Service start date", { exact: true }),
  ).toHaveValue("2026-11-01");
  await expect(
    page.getByLabel("Payment terms (days)", { exact: true }),
  ).toHaveValue("17");
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹3,432.00",
  );
  await page.screenshot({
    path: ".impeccable/review/p9-quote-assist-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("tick its review box");
  await page
    .getByLabel("I reviewed the current calculated estimate", { exact: true })
    .check();
  let drop = true;
  await page.route("**/api/subscriptions", async (route) => {
    if (route.request().method() === "POST" && drop) {
      drop = false;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("may have completed");
  await expect(page.getByLabel("Line 1 quantity", { exact: true })).toHaveValue(
    "2",
  );
  await expect(
    page.getByLabel("I reviewed the current calculated estimate", {
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByLabel("I reviewed the current calculated estimate", { exact: true })
    .check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  expect(
    (
      await (
        await api.get(`/api/subscriptions?customerId=${data.maya.id}`)
      ).json()
    ).total,
  ).toBe(before + 1);
  await page.reload();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
});

test("customer changes clear AI binding and a changed catalog price requires a fresh explicit review", async ({
  page,
  request: api,
}) => {
  const data = await fixture(api);
  await login(page);
  await newDraft(page, data.maya.id);
  await suggest(page);
  await apply(page);
  await page.getByLabel("Customer", { exact: true }).selectOption(data.arun.id);
  await expect(
    page.getByLabel("I reviewed the current calculated estimate", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Suggested offering", exact: true }),
  ).toHaveCount(0);
  await suggest(page);
  await apply(page);
  await page
    .getByLabel("I reviewed the current calculated estimate", { exact: true })
    .check();
  const {
    id: planId,
    version,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    primaryProductName: _name,
    ...input
  } = data.plan;
  void _createdAt;
  void _updatedAt;
  void _name;
  await write(
    api,
    `/api/plans/${planId}`,
    { ...input, price: 120000, version },
    "PUT",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/changed|review/i);
  await expect(
    page.getByLabel("Payment terms (days)", { exact: true }),
  ).toHaveValue("17");
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹3,872.00",
  );
  await expect(
    page.getByLabel("I reviewed the current calculated estimate", {
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByLabel("I reviewed the current calculated estimate", { exact: true })
    .check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
});

test("refusal, invalid output, timeout and disabled assist retain manual fields and ordinary save", async ({
  page,
  request: api,
}) => {
  const data = await fixture(api);
  await login(page, "admin@brightloop.test");
  await newDraft(page, data.maya.id);
  await page
    .getByLabel("Recurring plan", { exact: true })
    .selectOption(data.plan.id);
  for (const [request, message] of [
    ["refusal for a software request", "No usable suggestion"],
    ["invalid software request", "allowed format"],
    ["timeout for a software request", "timed out"],
  ]) {
    await suggest(page, request);
    await expect(
      page.locator(".quote-assist").getByRole("alert"),
    ).toContainText(message);
    await expect(
      page.getByLabel("Recurring plan", { exact: true }),
    ).toHaveValue(data.plan.id);
    await expect(
      page.getByLabel("Payment terms (days)", { exact: true }),
    ).toHaveValue("17");
  }
  await page.route("**/api/ai/quote-assist", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        reason: "Optional assist is turned off.",
        model: "gpt-4.1-mini",
        budget: { capUsd: "0", committedUsd: "0", remainingUsd: "0" },
        disclosure: "",
      },
    }),
  );
  await page.locator(".quote-assist > summary").click();
  await page.locator(".quote-assist > summary").click();
  await expect(page.locator(".quote-assist")).toContainText(
    "Optional assist is turned off.",
  );
  await expect(
    page.getByRole("button", { name: "Suggest selections", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  expect((await page.request.get("/api/ai/quote-assist")).status()).toBe(200);
});

test("a template-only suggestion copies the template's saved lines for normal price review", async ({
  page,
  request: api,
}) => {
  const data = await fixture(api);
  await write(api, "/api/quotation-templates", {
    name: "AA AI Saved Template",
    planId: data.plan.id,
    validDays: 14,
    active: true,
    lines: [
      {
        productId: data.product.id,
        variantId: data.product.variants[0].id,
        quantity: 3,
      },
    ],
  });
  await login(page, "admin@brightloop.test");
  await newDraft(page, data.maya.id);
  await suggest(
    page,
    "Use the saved template for this monthly software offering",
  );
  await expect(
    page.getByRole("region", { name: "Suggested offering", exact: true }),
  ).toContainText("AA AI Saved Template");
  await page
    .getByRole("button", { name: "Apply suggested fields", exact: true })
    .click();
  await expect(page.getByLabel("Line 1 quantity", { exact: true })).toHaveValue(
    "3",
  );
  await expect(
    page.getByLabel("Quotation validity (days)", { exact: true }),
  ).toHaveValue("14");
  await expect(
    page.getByLabel("Payment terms (days)", { exact: true }),
  ).toHaveValue("17");
  const subtotal = (data.plan.price + data.product.variants[0].adjustment) * 3;
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    formatMoney(subtotal + subtotal / 10),
  );
  await page
    .getByLabel("I reviewed the current calculated estimate", { exact: true })
    .check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
});
