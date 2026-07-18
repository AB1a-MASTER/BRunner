import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("./", import.meta.url));
const STATIC_INPUTS = Object.freeze([
  "package.json",
  "package-lock.json",
  "vite.studio.config.js",
  "studioBuildFingerprint.mjs",
]);
const SOURCE_DIRECTORIES = Object.freeze(["BRunner/studio-graph-src"]);
const IMPORT_EXTENSIONS = Object.freeze([
  "",
  ".js",
  ".jsx",
  ".mjs",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
]);
const PARSED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".css", ".html"]);

async function walkFiles(directory, repositoryRoot) {
  const entries = await readdir(path.join(repositoryRoot, directory), {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(directory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(relativePath, repositoryRoot));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

export async function listStudioBuildInputs(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const inputs = new Set(STATIC_INPUTS);
  for (const directory of SOURCE_DIRECTORIES) {
    for (const input of await walkFiles(directory, repositoryRoot)) inputs.add(input);
  }

  const queue = [...inputs].sort((left, right) => left.localeCompare(right));
  while (queue.length) {
    const importer = queue.shift();
    if (!PARSED_EXTENSIONS.has(path.posix.extname(importer).toLowerCase())) continue;
    const source = await readFile(path.join(repositoryRoot, importer), "utf8");
    const specifiers = extractLocalImportSpecifiers(source, importer);
    for (const specifier of specifiers) {
      const resolved = await resolveRepositoryImport(
        repositoryRoot,
        importer,
        specifier,
      );
      if (!resolved || inputs.has(resolved)) continue;
      inputs.add(resolved);
      queue.push(resolved);
      queue.sort((left, right) => left.localeCompare(right));
    }
  }

  return [...inputs].sort((left, right) => left.localeCompare(right));
}

export async function computeStudioBuildFingerprint(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
) {
  const inputs = await listStudioBuildInputs(repositoryRoot);
  const hash = createHash("sha256");
  hash.update("brunner-studio-build-v2\0");

  for (const input of inputs) {
    hash.update(input);
    hash.update("\0");
    hash.update(await readFile(path.join(repositoryRoot, input)));
    hash.update("\0");
  }

  return {
    version: 2,
    algorithm: "sha256",
    inputHash: hash.digest("hex"),
    inputs,
  };
}

function extractLocalImportSpecifiers(source, importer) {
  const extension = path.posix.extname(importer).toLowerCase();
  const patterns = extension === ".css"
    ? [
        /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/g,
        /url\(\s*["']?([^"')]+)["']?\s*\)/g,
      ]
    : extension === ".html"
      ? [/(?:src|href)\s*=\s*["']([^"']+)["']/g]
      : [
          /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']/gs,
          /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        ];
  const specifiers = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = String(match[1] || "").trim();
      if (isLocalSpecifier(specifier)) specifiers.add(specifier);
    }
  }
  return [...specifiers].sort((left, right) => left.localeCompare(right));
}

function isLocalSpecifier(specifier) {
  if (!specifier || specifier.startsWith("#")) return false;
  if (/^(?:[a-z]+:|\/\/)/i.test(specifier)) return false;
  return specifier.startsWith(".") || specifier.startsWith("/");
}

async function resolveRepositoryImport(repositoryRoot, importer, specifier) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0].replaceAll("\\", "/");
  const unresolved = cleanSpecifier.startsWith("/")
    ? path.posix.join(SOURCE_DIRECTORIES[0], cleanSpecifier.slice(1))
    : path.posix.join(path.posix.dirname(importer), cleanSpecifier);
  const normalized = path.posix.normalize(unresolved);
  if (!isRepositoryRelative(normalized)) return null;

  const candidates = [];
  for (const extension of IMPORT_EXTENSIONS) candidates.push(`${normalized}${extension}`);
  for (const extension of IMPORT_EXTENSIONS.slice(1)) {
    candidates.push(path.posix.join(normalized, `index${extension}`));
  }

  for (const candidate of candidates) {
    if (!isRepositoryRelative(candidate)) continue;
    const absolute = path.resolve(repositoryRoot, candidate);
    const repositoryRelative = path.relative(repositoryRoot, absolute);
    if (
      repositoryRelative === ""
      || repositoryRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(repositoryRelative)
    ) continue;
    try {
      if ((await stat(absolute)).isFile()) {
        return repositoryRelative.replaceAll(path.sep, "/");
      }
    } catch {
      // Try the next supported local import form.
    }
  }
  return null;
}

function isRepositoryRelative(value) {
  return Boolean(value && value !== ".." && !value.startsWith("../") && !path.posix.isAbsolute(value));
}
