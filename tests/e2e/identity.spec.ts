import { type Page as BrowserPage } from "@playwright/test";
import { test, expect } from './test';
import { DatabaseSync } from "node:sqlite";

const demoPassword = "Brightloop!2026";
async function login(
  page: BrowserPage,
  email = "admin@brightloop.test",
  password = demoPassword,
) {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}
function resetLink(recipient: string): string {
  if (!process.env.E2E_DATABASE_PATH)
    throw new Error("The isolated browser test database is not configured.");
  const db = new DatabaseSync(process.env.E2E_DATABASE_PATH, {
    readOnly: true,
  });
  try {
    const row = db
      .prepare(
        "SELECT body FROM outbox WHERE recipient=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(recipient) as { body: string } | undefined;
    const link = row?.body.match(
      /http:\/\/localhost:3100\/reset-password#token=[a-f0-9]{64}/,
    )?.[0];
    if (!link)
      throw new Error("The synthetic reset message was not generated.");
    return link;
  } finally {
    db.close();
  }
}

test("customer signup validates the exact boundary, persists, and keeps internal destinations private", async ({
  page,
}) => {
  await page.goto("/signup");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByLabel("Full name")).toBeFocused();
  await expect(page.getByLabel("Full name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Full name").fill("Browser Customer");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("browser-customer@brightloop.test");
  await page.getByLabel("Password", { exact: true }).fill("Abcdefg!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("Use at least 9 characters.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("Abcdefgh!");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("browser-customer@brightloop.test", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Team access", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Customers", exact: true }),
  ).toHaveCount(0);
  await page.goto("/staff");
  await expect(
    page.getByRole("heading", {
      name: "This area is restricted.",
      exact: true,
    }),
  ).toBeVisible();
  const forbidden = await page.request.get("/api/staff");
  expect(forbidden.status()).toBe(403);
});

test("admin creates one staff account, searches it, reloads and preserves failed input", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Team access", exact: true }).click();
  await page
    .getByRole("link", { name: "Add staff member", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add staff member", exact: true })
    .click();
  await expect(page.getByLabel("Full name")).toBeFocused();
  await page.getByLabel("Full name").fill("Browser Staff");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("browser-staff@brightloop.test");
  await page.getByLabel("Initial password", { exact: true }).fill("Staffpass!");
  let submissions = 0;
  await page.route("**/api/staff", async (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Add staff member", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
  await page
    .getByRole("form", { name: "Add staff member" })
    .dispatchEvent("submit");
  await expect(
    page.getByRole("heading", { name: "Team access", exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
  await page
    .getByRole("searchbox", { name: "Search by name or email" })
    .fill("browser-staff");
  await expect(page).toHaveURL(/q=browser-staff/);
  await expect(
    page.getByText("browser-staff@brightloop.test", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("browser-staff");
  await expect(
    page.getByText("browser-staff@brightloop.test", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Clear search", { exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await page
    .getByRole("link", { name: "Add staff member", exact: true })
    .click();
  await page.getByLabel("Full name").fill("Retained Name");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("browser-staff@brightloop.test");
  await page.getByLabel("Initial password", { exact: true }).fill("Staffpass!");
  await page
    .getByRole("button", { name: "Add staff member", exact: true })
    .click();
  await expect(
    page.getByText("This email is already registered.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Retained Name");
  await expect(page.getByLabel("Email address", { exact: true })).toBeFocused();
});

test("dirty form navigation uses an app-owned, keyboard-accessible confirmation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/staff/new");
  await page.getByLabel("Full name").fill("Unsaved person");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Leave this form?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep editing", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Unsaved person");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard entries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Team access", exact: true }),
  ).toBeVisible();
});

test("reset journey uses a generated synthetic message, scrubs the fragment and prevents replay", async ({
  page,
}) => {
  const recipient = "browser-reset@brightloop.test";
  const signup = await page.request.post("/api/auth/signup", {
    data: { name: "Reset Browser", email: recipient, password: "Oldpassw!" },
  });
  expect(signup.status()).toBe(201);
  await page.goto("/forgot-password");
  await page.getByLabel("Email address", { exact: true }).fill(recipient);
  await page
    .getByRole("button", { name: "Request reset link", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "If that address is registered",
  );
  const link = resetLink(recipient);
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "A fresh start.", exact: true }),
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash.length === 0).toBe(true);
  await page.getByLabel("New password", { exact: true }).fill("Newpassw!");
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Password updated");
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  const replay = await page.request.post("/api/auth/reset-password", {
    data: { token, password: "Otherpas!" },
  });
  expect(replay.status()).toBe(400);
  await login(page, recipient, "Newpassw!");
});

test("staff direct admin destinations are denied; internal customer search has recovery states", async ({
  page,
}) => {
  await login(page, "staff@brightloop.test");
  await expect(
    page.getByRole("link", { name: "Team access", exact: true }),
  ).toHaveCount(0);
  await page.goto("/staff/new");
  await expect(
    page.getByRole("heading", {
      name: "This area is restricted.",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/customers");
  await expect(
    page.getByRole("heading", { name: "Customers", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("no-such-customer");
  await expect(
    page.getByRole("heading", { name: "No matching accounts.", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Clear search", { exact: true }).click();
  await expect(
    page.getByText("maya@brightloop.test", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/customers?**", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("could not be reached");
  await page.unroute("**/api/customers?**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("maya@brightloop.test", { exact: true }),
  ).toBeVisible();
});

test("narrow screens preserve the form and directory without horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await login(page);
  await page.getByRole("link", { name: "Team access", exact: true }).click();
  await expect(
    page.getByText("staff@brightloop.test", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("link", { name: "Add staff member", exact: true })
    .click();
  await expect(
    page.getByLabel("Initial password", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("an expired session preserves a dirty form until deliberate sign-in recovery", async ({
  page,
}) => {
  await login(page);
  await page.goto("/staff/new");
  await page.getByLabel("Full name").fill("Preserved until sign in");
  if (!process.env.E2E_DATABASE_PATH)
    throw new Error("The isolated browser test database is not configured.");
  const db = new DatabaseSync(process.env.E2E_DATABASE_PATH);
  try {
    db.prepare(
      "DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE email=?)",
    ).run("admin@brightloop.test");
  } finally {
    db.close();
  }
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText(
    "Your session has expired",
  );
  await expect(page.getByLabel("Full name")).toHaveValue(
    "Preserved until sign in",
  );
  await page.getByRole("link", { name: "Sign in again", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Leave this form?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Discard entries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("admin@brightloop.test");
  await page.getByLabel("Password", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Database connected", { exact: true }),
  ).toBeVisible();
});
