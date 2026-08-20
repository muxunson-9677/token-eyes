#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateRunMetadata(runId, runUrl) {
  if (runId === "local") {
    if (runUrl !== null) throw new Error("Local run URL must be null");
    return;
  }
  if (!/^[1-9]\d*$/.test(String(runId || ""))) {
    throw new Error("Run ID must be 'local' or a positive numeric CI run ID");
  }
  let parsed;
  try {
    parsed = new URL(runUrl);
  } catch {
    throw new Error("Run URL must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Run URL must be a valid HTTPS URL without credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Run URL must not contain a query or fragment");
  }
  const expectedPath = `/actions/runs/${runId}`;
  if (!parsed.pathname.endsWith(expectedPath)) {
    throw new Error("Run URL must identify the supplied run ID");
  }
}

function validateOptions({ artifactPaths, version, headSha, runId, runUrl, outputDir }) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ""))) {
    throw new Error("Version must be X.Y.Z");
  }
  if (!/^[0-9a-f]{40}$/i.test(String(headSha || ""))) {
    throw new Error("Head SHA must be exactly 40 hexadecimal characters");
  }
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    throw new Error("At least one artifact path is required");
  }
  if (typeof outputDir !== "string" || !outputDir.trim()) {
    throw new Error("Output directory is required");
  }
  validateRunMetadata(runId, runUrl);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function describeArtifacts(artifactPaths, version) {
  const versionPattern = new RegExp(`(^|[^0-9])${escapeRegExp(version)}($|[^0-9])`);
  const fileNames = new Set();
  const artifacts = [];
  for (const artifactPath of artifactPaths) {
    let stat;
    try {
      stat = await fsPromises.stat(artifactPath);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`Artifact does not exist: ${artifactPath}`);
      throw error;
    }
    if (!stat.isFile()) throw new Error(`Artifact is not a file: ${artifactPath}`);
    const fileName = path.basename(artifactPath);
    if (!versionPattern.test(fileName)) {
      throw new Error(`Artifact filename version must match ${version}: ${fileName}`);
    }
    if (!/\.msi$/i.test(fileName) && !/-setup\.exe$/i.test(fileName)) {
      throw new Error(`Artifact must be a Tauri MSI or NSIS installer: ${fileName}`);
    }
    if (fileNames.has(fileName)) throw new Error(`Duplicate artifact filename: ${fileName}`);
    fileNames.add(fileName);
    artifacts.push({ file_name: fileName, sha256: await hashFile(artifactPath) });
  }
  artifacts.sort((left, right) => {
    if (left.file_name < right.file_name) return -1;
    if (left.file_name > right.file_name) return 1;
    return 0;
  });
  return artifacts;
}

async function assertExistingOutputIsSafe(filePath, expectedContent) {
  try {
    const existing = await fsPromises.readFile(filePath, "utf8");
    if (existing !== expectedContent) {
      throw new Error(`Refusing to overwrite different existing content: ${filePath}`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function generateWindowsReleaseMetadata(options) {
  validateOptions(options);
  const {
    artifactPaths,
    version,
    headSha,
    runId,
    runUrl,
    outputDir,
  } = options;
  const artifacts = await describeArtifacts(artifactPaths, version);
  const provenance = {
    schema_version: 1,
    version,
    head_sha: headSha.toLowerCase(),
    run_id: runId,
    run_url: runUrl,
    artifacts,
  };
  const checksumsContent = `${artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.file_name}`)
    .join("\n")}\n`;
  const provenanceContent = `${JSON.stringify(provenance, null, 2)}\n`;
  const checksumsPath = path.join(outputDir, `checksums-v${version}.txt`);
  const provenancePath = path.join(outputDir, `build-provenance-v${version}.json`);

  const checksumsExist = await assertExistingOutputIsSafe(checksumsPath, checksumsContent);
  const provenanceExists = await assertExistingOutputIsSafe(provenancePath, provenanceContent);
  await fsPromises.mkdir(outputDir, { recursive: true });
  if (!checksumsExist) await fsPromises.writeFile(checksumsPath, checksumsContent, { flag: "wx" });
  if (!provenanceExists) await fsPromises.writeFile(provenancePath, provenanceContent, { flag: "wx" });
  return { checksumsPath, provenancePath };
}

function parseArguments(argv) {
  const options = { artifactPaths: [] };
  const names = new Map([
    ["--version", "version"],
    ["--head-sha", "headSha"],
    ["--run-id", "runId"],
    ["--run-url", "runUrl"],
    ["--output-dir", "outputDir"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--artifact") {
      options.artifactPaths.push(value);
    } else if (names.has(flag)) {
      const name = names.get(flag);
      if (Object.hasOwn(options, name)) throw new Error(`Duplicate argument: ${flag}`);
      options[name] = flag === "--run-url" && value === "null" ? null : value;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
    index += 1;
  }
  return options;
}

async function main() {
  const result = await generateWindowsReleaseMetadata(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { generateWindowsReleaseMetadata, parseArguments };
