import { expect, test } from "@playwright/test";
import {
  chooseFileSource,
  createRun,
  exampleWorkflowNames,
  mockWorkflowBackend,
  openRunPage,
  selectRunWorkflow,
  workflowPickerOptions,
} from "./workflow.e2e-support";

test.describe("example workflow runs", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkflowBackend(page);
  });

  test("seeded example workflows are available in the run picker", async ({ page }) => {
    await openRunPage(page);

    const options = await workflowPickerOptions(page);
    expect(options).toEqual(expect.arrayContaining(exampleWorkflowNames));
  });

  test("YouTube Video Quick Review completes with a video report", async ({ page }) => {
    await openRunPage(page);
    await selectRunWorkflow(page, "YouTube Video Quick Review");
    await page.getByPlaceholder("https://www.youtube.com/watch?v=...").fill("https://youtu.be/video-review-demo");

    await createRun(page);

    await expect(page.getByRole("button", { name: "YouTube Video Quick Review run succeeded" })).toBeVisible();
    await expect(page.getByText("workflow-output/youtube-video/quick-review-video.mp4", { exact: true })).toBeVisible();
  });

  test("YouTube Collection Spot Check completes with a collection report", async ({ page }) => {
    await openRunPage(page);
    await selectRunWorkflow(page, "YouTube Collection Spot Check");
    await page.getByPlaceholder("https://www.youtube.com/playlist?list=...").fill("https://www.youtube.com/playlist?list=PLmock");

    await createRun(page);

    await expect(page.getByRole("button", { name: "YouTube Collection Spot Check run succeeded" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Collection Items" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Quick review clip" }).first()).toBeVisible();
  });

  test("Song Analysis Quick Match completes with a song report", async ({ page }) => {
    await openRunPage(page);
    await selectRunWorkflow(page, "Song Analysis Quick Match");
    await page.getByPlaceholder("https://www.youtube.com/watch?v=...").fill("https://youtu.be/song-match-demo");

    await createRun(page);

    await expect(page.getByRole("button", { name: "Song Analysis Quick Match run succeeded" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Song Identification" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Mock Anthem" })).toBeVisible();
  });

  test("Subtitle SRT Starter completes with a subtitle report", async ({ page }) => {
    await openRunPage(page);
    await selectRunWorkflow(page, "Subtitle SRT Starter");
    await chooseFileSource(page);
    await page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Run Input" }) })
      .first()
      .locator("input")
      .first()
      .fill("fixtures/subtitle-source.mp4");

    await createRun(page);

    await expect(page.getByRole("button", { name: "Subtitle SRT Starter run succeeded" })).toBeVisible();
    await expect(page.getByText("workflow-output/subtitle-generation/subtitle-demo.srt", { exact: true })).toBeVisible();
  });
});
