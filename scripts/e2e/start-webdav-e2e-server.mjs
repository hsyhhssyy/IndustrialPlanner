import { createHash } from "node:crypto";
import { openSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const VERSION = "5.14.2";
const HOST = "127.0.0.1";
const PORT = 4175;
const USERNAME = "industrial-planner-e2e";
const PASSWORD = "industrial-planner-e2e";
const APP_ORIGIN = "http://127.0.0.1:4174";
const RUNTIME_ROOT = resolve(".temp/playwright-test/webdav-server");

const RELEASES = {
  "darwin-arm64": {
    archive: "darwin-arm64-webdav.tar.gz",
    sha256: "c836381ad3f93c4da35ee6c9cf78defab0337e2fac8c2b72481526052043f585",
  },
  "darwin-x64": {
    archive: "darwin-amd64-webdav.tar.gz",
    sha256: "f8c0f989a491861775025d125d0a02861b72a0a5e1d841cdbaa98d1f42415c0e",
  },
  "linux-arm64": {
    archive: "linux-arm64-webdav.tar.gz",
    sha256: "4aef81afac595de0dde6c8d57fed77e7acef6d6fd356503fd26f049ac5c03d06",
  },
  "linux-x64": {
    archive: "linux-amd64-webdav.tar.gz",
    sha256: "4ca5a83ef5ccc318586bdb0102d4e45f174fd9a6e3d026fc914dc6ea06dd2aed",
  },
  "win32-arm64": {
    archive: "windows-arm64-webdav.zip",
    sha256: "c95d8e3887cc1c0fb2229c2a720a04e0f12952f05d979e0e1b8b0edb6d6682eb",
  },
  "win32-x64": {
    archive: "windows-amd64-webdav.zip",
    sha256: "81d9e1139b652d6aad3710fb025d67622f68184e036cb1b43408fe18ab6eceab",
  },
};

async function main() {
  const releaseKey = `${process.platform}-${process.arch}`;
  const release = RELEASES[releaseKey];
  if (release === undefined) {
    throw new Error(`Unsupported WebDAV E2E platform: ${releaseKey}`);
  }

  const installDirectory = join(RUNTIME_ROOT, "bin", `v${VERSION}`, releaseKey);
  const executablePath = join(
    installDirectory,
    process.platform === "win32" ? "webdav.exe" : "webdav",
  );
  await ensureWebDavExecutable({ executablePath, installDirectory, release });

  const runtimeDirectory = join(RUNTIME_ROOT, "runtime");
  const dataDirectory = join(runtimeDirectory, "data");
  const configPath = join(runtimeDirectory, "config.json");
  await rm(runtimeDirectory, { recursive: true, force: true });
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    address: HOST,
    port: PORT,
    tls: false,
    prefix: "/",
    directory: dataDirectory,
    permissions: "CRUD",
    rules: [],
    log: {
      format: "console",
      colors: false,
      outputs: ["stderr"],
    },
    cors: {
      enabled: true,
      credentials: true,
      allowed_hosts: [APP_ORIGIN],
      allowed_headers: [
        "Authorization",
        "Content-Type",
        "Depth",
        "Destination",
        "If",
        "If-Match",
        "If-None-Match",
        "Overwrite",
      ],
      allowed_methods: [
        "DELETE",
        "GET",
        "HEAD",
        "MKCOL",
        "MOVE",
        "OPTIONS",
        "PROPFIND",
        "PUT",
      ],
      exposed_headers: [
        "Content-Length",
        "ETag",
        "Last-Modified",
      ],
    },
    users: [{
      username: USERNAME,
      password: PASSWORD,
      permissions: "CRUD",
    }],
  }, null, 2));

  const logFileDescriptor = openSync(join(runtimeDirectory, "server.log"), "a");
  const server = spawn(executablePath, ["--config", configPath], {
    stdio: ["ignore", logFileDescriptor, logFileDescriptor],
    windowsHide: true,
  });
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (!server.killed) {
      server.kill(signal);
    }
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const exitPromise = new Promise((resolveExit, rejectExit) => {
    server.once("error", rejectExit);
    server.once("exit", (code, signal) => {
      if (!shuttingDown && code !== 0) {
        rejectExit(new Error(
          `WebDAV E2E server exited before teardown (code=${String(code)}, signal=${String(signal)}).`,
        ));
        return;
      }
      resolveExit(code ?? 0);
    });
  });

  try {
    await waitUntilReady(exitPromise);
    console.log(`[webdav-e2e] ready at http://${HOST}:${PORT}`);
    const code = await exitPromise;
    process.exitCode = typeof code === "number" ? code : 0;
  } catch (error) {
    shutdown("SIGTERM");
    throw error;
  }
}

async function ensureWebDavExecutable({ executablePath, installDirectory, release }) {
  if (await hasExpectedVersion(executablePath)) {
    return;
  }

  await rm(installDirectory, { recursive: true, force: true });
  await mkdir(installDirectory, { recursive: true });
  const archivePath = join(installDirectory, release.archive);
  const downloadUrl = `https://github.com/hacdias/webdav/releases/download/v${VERSION}/${release.archive}`;
  console.log(`[webdav-e2e] downloading ${downloadUrl}`);
  const response = await fetch(downloadUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download WebDAV E2E server: HTTP ${response.status}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(archive).digest("hex");
  if (actualSha256 !== release.sha256) {
    throw new Error(
      `WebDAV E2E server checksum mismatch: expected ${release.sha256}, received ${actualSha256}.`,
    );
  }
  await writeFile(archivePath, archive);

  const extraction = spawnSync(
    "tar",
    [process.platform === "win32" ? "-xf" : "-xzf", archivePath, "-C", installDirectory],
    { encoding: "utf8", windowsHide: true },
  );
  await rm(archivePath, { force: true });
  if (extraction.status !== 0) {
    throw new Error(
      `Failed to extract WebDAV E2E server: ${extraction.stderr || extraction.stdout}`,
    );
  }
  if (process.platform !== "win32") {
    await chmod(executablePath, 0o755);
  }
  if (!(await hasExpectedVersion(executablePath))) {
    throw new Error(`Downloaded WebDAV executable is not v${VERSION}.`);
  }
}

async function hasExpectedVersion(executablePath) {
  try {
    await readFile(executablePath);
    const result = spawnSync(executablePath, ["version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0
      && `${result.stdout}\n${result.stderr}`.includes(VERSION);
  } catch {
    return false;
  }
}

async function waitUntilReady(exitPromise) {
  const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
  const timeoutAt = Date.now() + 30_000;
  while (Date.now() < timeoutAt) {
    const probe = fetch(`http://${HOST}:${PORT}/`, {
      method: "PROPFIND",
      headers: {
        Authorization: authorization,
        Depth: "0",
        Origin: APP_ORIGIN,
      },
    }).then((response) => response.status);
    const outcome = await Promise.race([
      probe.catch(() => null),
      exitPromise.then(() => "exited"),
      new Promise((resolveDelay) => setTimeout(() => resolveDelay(null), 250)),
    ]);
    if (outcome === 207) {
      return;
    }
    if (outcome === "exited") {
      throw new Error("WebDAV E2E server exited during its readiness probe.");
    }
  }
  throw new Error("WebDAV E2E server did not become ready within 30 seconds.");
}

main().catch((error) => {
  console.error(`[webdav-e2e] ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
