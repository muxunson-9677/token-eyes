#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--private", "--public"].includes(name) || !value) {
      throw new Error("Usage: --private <path> --public <path>");
    }
    options[name === "--private" ? "privatePath" : "publicPath"] = path.resolve(value);
  }
  if (!options.privatePath || !options.publicPath) {
    throw new Error("Both --private and --public are required");
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (fs.existsSync(options.privatePath)) {
    throw new Error("Private key already exists; refusing to overwrite it");
  }
  if (fs.existsSync(options.publicPath)) {
    throw new Error("Public key already exists; refusing to overwrite it");
  }
  fs.mkdirSync(path.dirname(options.privatePath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(options.publicPath), { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  try {
    fs.writeFileSync(options.privatePath, privatePem, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.writeFileSync(options.publicPath, publicPem, {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx",
    });
  } catch (error) {
    if (!fs.existsSync(options.publicPath)) {
      fs.rmSync(options.privatePath, { force: true });
    }
    throw error;
  }
  process.stdout.write("Generated Codex reset feed signing key pair; private key material was not displayed.\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message || "Key generation failed"}\n`);
  process.exitCode = 1;
}
