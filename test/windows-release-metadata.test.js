const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const GENERATOR_PATH = path.join(
  __dirname,
  "..",
  "scripts",
  "generate-windows-release-metadata.cjs"
);
const VERSION = "0.54.44";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const CI_RUN_ID = "123456789";
const CI_RUN_URL = `https://github.com/example/token-eyes/actions/runs/${CI_RUN_ID}`;

function loadGenerator() {
  delete require.cache[require.resolve(GENERATOR_PATH)];
  return require(GENERATOR_PATH).generateWindowsReleaseMetadata;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function withTempDir(run) {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "token-eyes-release-metadata-"));
  try {
    return await run(tempDir);
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeArtifact(tempDir, fileName, contents) {
  const artifactPath = path.join(tempDir, fileName);
  await fsPromises.writeFile(artifactPath, contents);
  return artifactPath;
}

test("Task 11 release metadata deterministically sorts artifacts and records exact SHA-256 values", async () => {
  await withTempDir(async (tempDir) => {
    const nsisName = `Token Eyes_${VERSION}_x64-setup.exe`;
    const msiName = `Token Eyes_${VERSION}_x64_en-US.msi`;
    const nsis = await writeArtifact(tempDir, nsisName, Buffer.from("synthetic-nsis\n"));
    const msi = await writeArtifact(tempDir, msiName, Buffer.from("synthetic-msi\n"));
    const outputDir = path.join(tempDir, "metadata");

    const generate = loadGenerator();
    const result = await generate({
      artifactPaths: [msi, nsis],
      version: VERSION,
      headSha: HEAD_SHA,
      runId: CI_RUN_ID,
      runUrl: CI_RUN_URL,
      outputDir,
    });

    assert.deepEqual(result, {
      checksumsPath: path.join(outputDir, `checksums-v${VERSION}.txt`),
      provenancePath: path.join(outputDir, `build-provenance-v${VERSION}.json`),
    });
    const provenance = JSON.parse(await fsPromises.readFile(result.provenancePath, "utf8"));
    assert.deepEqual(provenance, {
      schema_version: 1,
      version: VERSION,
      head_sha: HEAD_SHA,
      run_id: CI_RUN_ID,
      run_url: CI_RUN_URL,
      artifacts: [
        { file_name: nsisName, sha256: sha256("synthetic-nsis\n") },
        { file_name: msiName, sha256: sha256("synthetic-msi\n") },
      ],
    });
    assert.equal(
      await fsPromises.readFile(result.checksumsPath, "utf8"),
      `${sha256("synthetic-nsis\n")}  ${nsisName}\n${sha256("synthetic-msi\n")}  ${msiName}\n`
    );
  });
});

test("Task 11 release metadata CLI consumes every explicit provenance argument", async () => {
  await withTempDir(async (tempDir) => {
    const artifact = await writeArtifact(
      tempDir,
      `Token Eyes_${VERSION}_x64-setup.exe`,
      "synthetic"
    );
    const outputDir = path.join(tempDir, "metadata");
    const result = childProcess.spawnSync(process.execPath, [
      GENERATOR_PATH,
      "--artifact", artifact,
      "--version", VERSION,
      "--head-sha", HEAD_SHA,
      "--run-id", CI_RUN_ID,
      "--run-url", CI_RUN_URL,
      "--output-dir", outputDir,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(outputDir, `checksums-v${VERSION}.txt`)));
    assert.ok(fs.existsSync(path.join(outputDir, `build-provenance-v${VERSION}.json`)));
  });
});

test("Task 11 release metadata permits only the explicit local run sentinel without a run URL", async () => {
  await withTempDir(async (tempDir) => {
    const artifact = await writeArtifact(
      tempDir,
      `Token Eyes_${VERSION}_x64-setup.exe`,
      "synthetic"
    );
    const outputDir = path.join(tempDir, "metadata");
    const generate = loadGenerator();

    await generate({
      artifactPaths: [artifact],
      version: VERSION,
      headSha: HEAD_SHA,
      runId: "local",
      runUrl: null,
      outputDir,
    });

    const provenance = JSON.parse(await fsPromises.readFile(
      path.join(outputDir, `build-provenance-v${VERSION}.json`),
      "utf8"
    ));
    assert.equal(provenance.run_id, "local");
    assert.equal(provenance.run_url, null);
  });
});

test("Task 11 release metadata rejects a missing artifact before writing output", async () => {
  await withTempDir(async (tempDir) => {
    const outputDir = path.join(tempDir, "metadata");
    const generate = loadGenerator();
    await assert.rejects(
      generate({
        artifactPaths: [path.join(tempDir, `Token Eyes_${VERSION}_x64-setup.exe`)],
        version: VERSION,
        headSha: HEAD_SHA,
        runId: "local",
        runUrl: null,
        outputDir,
      }),
      /artifact.*does not exist/i
    );
    assert.equal(fs.existsSync(outputDir), false);
  });
});

test("Task 11 release metadata rejects an invalid 40-character Git SHA", async () => {
  await withTempDir(async (tempDir) => {
    const artifact = await writeArtifact(
      tempDir,
      `Token Eyes_${VERSION}_x64-setup.exe`,
      "synthetic"
    );
    const generate = loadGenerator();
    for (const headSha of ["short", "z".repeat(40), `${HEAD_SHA}0`]) {
      await assert.rejects(
        generate({
          artifactPaths: [artifact],
          version: VERSION,
          headSha,
          runId: "local",
          runUrl: null,
          outputDir: path.join(tempDir, "metadata"),
        }),
        /head SHA.*40.*hex/i
      );
    }
  });
});

test("Task 11 release metadata rejects an artifact whose filename version differs", async () => {
  await withTempDir(async (tempDir) => {
    const artifact = await writeArtifact(
      tempDir,
      "Token Eyes_0.54.43_x64-setup.exe",
      "synthetic"
    );
    const generate = loadGenerator();
    await assert.rejects(
      generate({
        artifactPaths: [artifact],
        version: VERSION,
        headSha: HEAD_SHA,
        runId: "local",
        runUrl: null,
        outputDir: path.join(tempDir, "metadata"),
      }),
      /artifact.*version.*0\.54\.44/i
    );
  });
});

test("Task 11 release metadata requires validated run metadata outside local mode", async () => {
  await withTempDir(async (tempDir) => {
    const artifact = await writeArtifact(
      tempDir,
      `Token Eyes_${VERSION}_x64-setup.exe`,
      "synthetic"
    );
    const generate = loadGenerator();
    const base = {
      artifactPaths: [artifact],
      version: VERSION,
      headSha: HEAD_SHA,
      outputDir: path.join(tempDir, "metadata"),
    };
    for (const runMetadata of [
      { runId: undefined, runUrl: undefined },
      { runId: CI_RUN_ID, runUrl: null },
      { runId: CI_RUN_ID, runUrl: `http://github.com/example/token-eyes/actions/runs/${CI_RUN_ID}` },
      { runId: "not-numeric", runUrl: CI_RUN_URL },
      { runId: CI_RUN_ID, runUrl: `${CI_RUN_URL}?access_token=synthetic-secret` },
      { runId: CI_RUN_ID, runUrl: `${CI_RUN_URL}#synthetic-secret` },
    ]) {
      await assert.rejects(
        generate({ ...base, ...runMetadata }),
        /run (ID|URL)|HTTPS/i
      );
    }
  });
});

test("Task 11 release metadata refuses different existing output and preserves it byte-for-byte", async () => {
  await withTempDir(async (tempDir) => {
    const artifact = await writeArtifact(
      tempDir,
      `Token Eyes_${VERSION}_x64-setup.exe`,
      "first"
    );
    const outputDir = path.join(tempDir, "metadata");
    const generate = loadGenerator();
    const options = {
      artifactPaths: [artifact],
      version: VERSION,
      headSha: HEAD_SHA,
      runId: "local",
      runUrl: null,
      outputDir,
    };
    const result = await generate(options);
    const originalChecksums = await fsPromises.readFile(result.checksumsPath);
    const originalProvenance = await fsPromises.readFile(result.provenancePath);

    await generate(options);
    await fsPromises.writeFile(artifact, "changed");
    await assert.rejects(generate(options), /refus.*overwrite|different existing content/i);
    assert.deepEqual(await fsPromises.readFile(result.checksumsPath), originalChecksums);
    assert.deepEqual(await fsPromises.readFile(result.provenancePath), originalProvenance);
  });
});
