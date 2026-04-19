import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  buildLocalMirrorRelativePath,
  createEmptyLocalMirrorManifest,
  determineLocalMirrorStatus,
  readLocalMirrorManifest,
  writeLocalMirrorManifest
} from "../../src/extension/localMirrorService";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("localMirrorService helpers", () => {
  it("builds workspace-hidden local mirror paths", () => {
    const relative = buildLocalMirrorRelativePath(
      { id: 100, name: "Regression" },
      { id: 501, summary: "Login works" }
    );
    assert.equal(
      relative,
      path.join(".kiwi-mirror", "plans", "100 - Regression", "cases", "501 - Login works.md")
    );
  });

  it("round-trips manifest files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kiwifs-mirror-unit-"));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, ".kiwi-mirror", "kiwi-mirror.json");
    const manifest = createEmptyLocalMirrorManifest();
    manifest.cases["501"] = {
      caseId: 501,
      planId: 100,
      localPath: path.join(".kiwi-mirror", "plans", "100 - Regression", "cases", "501 - Login works.md"),
      downloadedVersionToken: "history_id:10",
      downloadedContentHash: "abc123",
      lastDownloadedAt: "2026-04-09T00:00:00.000Z"
    };

    await writeLocalMirrorManifest(manifestPath, manifest);
    assert.deepEqual(await readLocalMirrorManifest(manifestPath), manifest);
  });

  it("derives compare states from local and remote state", () => {
    assert.equal(
      determineLocalMirrorStatus({
        hasLocal: true,
        hasRemote: true,
        localChanged: false,
        remoteChanged: false
      }),
      "unchanged"
    );
    assert.equal(
      determineLocalMirrorStatus({
        hasLocal: true,
        hasRemote: true,
        localChanged: true,
        remoteChanged: false
      }),
      "modified locally"
    );
    assert.equal(
      determineLocalMirrorStatus({
        hasLocal: true,
        hasRemote: true,
        localChanged: false,
        remoteChanged: true
      }),
      "remote changed"
    );
    assert.equal(
      determineLocalMirrorStatus({
        hasLocal: true,
        hasRemote: true,
        localChanged: true,
        remoteChanged: true
      }),
      "conflict"
    );
    assert.equal(
      determineLocalMirrorStatus({
        hasLocal: false,
        hasRemote: true,
        localChanged: false,
        remoteChanged: false
      }),
      "missing locally"
    );
    assert.equal(
      determineLocalMirrorStatus({
        hasLocal: true,
        hasRemote: false,
        localChanged: false,
        remoteChanged: false
      }),
      "missing remote"
    );
  });
});
