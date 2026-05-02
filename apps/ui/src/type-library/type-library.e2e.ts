import { expect, test, type Locator, type Page } from "@playwright/test";

const storageKey = "video-analysis.typeLibrary.v1";
const timestamp = "2026-05-02T00:00:00.000Z";

interface SeedTypeDefinition {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

test.describe("type library", () => {
  test("creates a new type", async ({ page }) => {
    await openTypeLibrary(page);

    const source = `{
  id: string;
  score: number;
  tags?: string[];
}`;

    await editorPanel(page).getByLabel("Name").fill("PlaywrightClip");
    await sourceEditor(page).fill(source);
    await editorPanel(page).getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Created PlaywrightClip.")).toBeVisible();
    await expect(definedTypesPanel(page).getByRole("button", { name: /PlaywrightClip/ })).toBeVisible();
    await expect(resolvedShapePanel(page).getByText('"type": "object"')).toBeVisible();

    const definitions = await storedTypeDefinitions(page);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      name: "PlaywrightClip",
      source,
    });
    await expect(page).toHaveURL(/\/types\/[^/]+$/);
  });

  test("opens overview and individual type pages", async ({ page }) => {
    await seedTypeDefinitions(page, [
      {
        id: "clip-type",
        name: "ClipType",
        source: "{ id: string; score: number; }",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "review-type",
        name: "ReviewType",
        source: "{ clip: ClipType; reviewed: boolean; }",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    await page.goto("/types");
    await expect(page).toHaveURL(/\/types$/);
    await expect(page.getByRole("heading", { name: "Type Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: /ClipType/ })).toBeVisible();

    await page.getByRole("link", { name: /ReviewType/ }).click();
    await expect(page).toHaveURL(/\/types\/review-type$/);
    await expect(page.getByRole("button", { name: "All Types" })).toBeVisible();
    await expect(editorPanel(page).getByRole("heading", { name: "Edit ReviewType" })).toBeVisible();
    await expect(page.getByText("/types/review-type")).toBeVisible();

    await page.getByRole("button", { name: "All Types" }).click();
    await expect(page).toHaveURL(/\/types$/);
    await expect(page.getByRole("heading", { name: "Type Overview" })).toBeVisible();
  });

  test("changes an existing type", async ({ page }) => {
    await seedTypeDefinitions(page, [
      {
        id: "clip-type",
        name: "ClipType",
        source: "{ id: string; }",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    await openTypeLibrary(page);
    await expect(editorPanel(page).getByRole("heading", { name: "Edit ClipType" })).toBeVisible();

    const source = `{
  id: string;
  reviewed: boolean;
}`;

    await editorPanel(page).getByLabel("Name").fill("ReviewedClip");
    await sourceEditor(page).fill(source);
    await editorPanel(page).getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Saved ReviewedClip.")).toBeVisible();
    await expect(definedTypesPanel(page).getByRole("button", { name: /ReviewedClip/ })).toBeVisible();
    await expect(definedTypesPanel(page).getByRole("button", { name: /ClipType/ })).toHaveCount(0);

    const definitions = await storedTypeDefinitions(page);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      id: "clip-type",
      name: "ReviewedClip",
      source,
      createdAt: timestamp,
    });
    expect(definitions[0].updatedAt).not.toBe(timestamp);
  });

  test("deletes an unused type", async ({ page }) => {
    await seedTypeDefinitions(page, [
      {
        id: "temporary-type",
        name: "TemporaryType",
        source: "{ id: string; }",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    await openTypeLibrary(page);
    page.once("dialog", (dialog) => dialog.accept());
    await editorPanel(page).getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Deleted TemporaryType.")).toBeVisible();
    await expect(definedTypesPanel(page).getByText("No types defined")).toBeVisible();
    await expect.poll(() => storedTypeDefinitions(page)).toEqual([]);
  });

  test("invalid name and invalid source prevent saving", async ({ page }) => {
    await seedTypeDefinitions(page, [
      {
        id: "existing-type",
        name: "ExistingType",
        source: "{ id: string; }",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    await openTypeLibrary(page);
    await definedTypesPanel(page).getByRole("button", { name: /ExistingType/ }).click();
    await page.getByRole("button", { name: "New" }).click();

    const saveButton = editorPanel(page).getByRole("button", { name: "Save" });
    await editorPanel(page).getByLabel("Name").fill("1Invalid");
    await expect(page.getByText("Type name must be a valid TypeScript identifier.")).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await editorPanel(page).getByLabel("Name").fill("ExistingType");
    await expect(page.getByText('Type "ExistingType" already exists.')).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await editorPanel(page).getByLabel("Name").fill("FunctionType");
    await sourceEditor(page).fill("() => string");
    await expect(page.getByText("Function types are not supported in workflow type contracts.")).toBeVisible();
    await expect(saveButton).toBeDisabled();

    const definitions = await storedTypeDefinitions(page);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      id: "existing-type",
      name: "ExistingType",
      source: "{ id: string; }",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  test("delete cancellation keeps the type", async ({ page }) => {
    await seedTypeDefinitions(page, [
      {
        id: "cancel-delete-type",
        name: "CancelDeleteType",
        source: "{ id: string; }",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    await openTypeLibrary(page);
    page.once("dialog", (dialog) => dialog.dismiss());
    await editorPanel(page).getByRole("button", { name: "Delete" }).click();

    await expect(definedTypesPanel(page).getByRole("button", { name: /CancelDeleteType/ })).toBeVisible();
    await expect(page.getByText("Deleted CancelDeleteType.")).toHaveCount(0);

    const definitions = await storedTypeDefinitions(page);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.name).toBe("CancelDeleteType");
  });

  test("referenced types cannot be deleted", async ({ page }) => {
    await seedTypeDefinitions(page, [
      {
        id: "base-type",
        name: "BaseType",
        source: "{ id: string; }",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "wrapper-type",
        name: "WrapperType",
        source: "{ base: BaseType; }",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    await openTypeLibrary(page);
    await definedTypesPanel(page).getByRole("button", { name: /BaseType/ }).click();
    await editorPanel(page).getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Remove references from WrapperType before deleting BaseType.")).toBeVisible();

    const definitions = await storedTypeDefinitions(page);
    expect(definitions).toHaveLength(2);
    expect(definitions.map((definition) => definition.name).sort()).toEqual(["BaseType", "WrapperType"]);
  });
});

async function openTypeLibrary(page: Page) {
  await page.goto("/types");
  await expect(page).toHaveURL(/\/types$/);
  await expect(page.getByRole("heading", { name: "Types", level: 1 })).toBeVisible();
  await expect(definedTypesPanel(page)).toBeVisible();
}

function definedTypesPanel(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Defined Types" }) }).first();
}

function editorPanel(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^(Create Type|Edit .+)$/ }) })
    .first();
}

function sourceEditor(page: Page): Locator {
  return editorPanel(page).locator("textarea");
}

function resolvedShapePanel(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Resolved Shape" }) }).first();
}

async function seedTypeDefinitions(page: Page, definitions: SeedTypeDefinition[]) {
  await page.addInitScript(
    ({ key, seededDefinitions }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          format: "video-analysis.type-library",
          version: 1,
          definitions: seededDefinitions,
        }),
      );
    },
    { key: storageKey, seededDefinitions: definitions },
  );
}

async function storedTypeDefinitions(page: Page): Promise<SeedTypeDefinition[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as { definitions?: SeedTypeDefinition[] };
    return Array.isArray(parsed.definitions) ? parsed.definitions : [];
  }, storageKey);
}
