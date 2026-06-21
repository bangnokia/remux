import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, copyFile, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const RELEASE_API_URL = "https://api.github.com/repos/bangnokia/telemux/releases/latest";
const SERVER_ASSET_NAME = "telemux-server-node24.tar.gz";

interface UpdateOptions {
  currentVersion: string;
  executablePath: string | undefined;
  log?: Pick<Console, "error" | "log">;
}

interface GitHubRelease {
  tagName: string;
  url: string;
  assetUrl: string;
}

export async function updateServerCli({
  currentVersion,
  executablePath,
  log = console
}: UpdateOptions): Promise<void> {
  const currentPath = executablePath ? resolve(executablePath) : null;
  if (!currentPath) {
    throw new Error("Unable to determine the current CLI path.");
  }

  await assertWritableFile(currentPath);

  log.log(`Checking latest Telemux release...`);
  const release = await fetchLatestRelease();
  const comparison = compareVersions(release.tagName, currentVersion);

  if (comparison <= 0) {
    log.log(`Telemux server ${currentVersion} is already up to date.`);
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "telemux-update-"));
  const archivePath = join(tempDir, SERVER_ASSET_NAME);
  const extractedPath = join(tempDir, "telemux-server.mjs");
  const backupPath = `${currentPath}.bak-${Date.now()}`;

  try {
    log.log(`Downloading ${release.tagName} from ${release.url}...`);
    await downloadFile(release.assetUrl, archivePath);
    extractServerCli(archivePath, tempDir);
    await assertReadableFile(extractedPath);
    await chmod(extractedPath, 0o755);

    await rename(currentPath, backupPath);
    try {
      await moveFileAcrossDevices(extractedPath, currentPath);
    } catch (error) {
      await rename(backupPath, currentPath).catch(() => undefined);
      throw error;
    }

    await rm(backupPath, { force: true });
    log.log(`Updated Telemux server from ${currentVersion} to ${release.tagName.replace(/^v/, "")}.`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertWritableFile(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`Current CLI path is not a file: ${path}`);
  }
  await access(path, constants.R_OK | constants.W_OK);
}

async function assertReadableFile(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`Release archive did not contain ${basename(path)}.`);
  }
  await access(path, constants.R_OK);
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "telemux-server-self-update"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed: ${response.status} ${response.statusText}`);
  }

  const parsed = await response.json() as {
    assets?: Array<{ browser_download_url?: unknown; name?: unknown }>;
    html_url?: unknown;
    tag_name?: unknown;
  };
  const tagName = typeof parsed.tag_name === "string" ? parsed.tag_name : "";
  const url = typeof parsed.html_url === "string" ? parsed.html_url : "GitHub Releases";
  const asset = parsed.assets?.find((item) => item.name === SERVER_ASSET_NAME);
  const assetUrl = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : "";

  if (!tagName || !assetUrl) {
    throw new Error(`Latest release does not include ${SERVER_ASSET_NAME}.`);
  }

  return { assetUrl, tagName, url };
}

async function downloadFile(url: string, path: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "telemux-server-self-update"
    }
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function moveFileAcrossDevices(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await rename(sourcePath, destinationPath);
    return;
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error;
    }
  }

  await copyFile(sourcePath, destinationPath);
  await chmod(destinationPath, 0o755);
  await rm(sourcePath, { force: true });
}

function isCrossDeviceRenameError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EXDEV"
  );
}

function extractServerCli(archivePath: string, outputDir: string): void {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", outputDir, "telemux-server.mjs"], {
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Unable to extract Telemux server archive.");
  }
}

function compareVersions(left: string, right: string): number {
  const leftParts = numericVersionParts(left);
  const rightParts = numericVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

function numericVersionParts(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}
