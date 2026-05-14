import { access, readFile, readdir, stat } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ProjectDevelopmentStage, ProjectDirectoryAnalysis } from "@/lib/types";

const execFileAsync = promisify(execFile);

const MAX_FILES = 2500;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TEXT_FILES = 160;
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const SECRET_FILE_PATTERNS = [
  /^\.env($|\.)/,
  /\.pem$/i,
  /\.key$/i,
  /secret/i,
  /credential/i,
];

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".dart",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt"]);
const CONFIG_NAMES = new Set([
  "app.json",
  "cargo.toml",
  "docker-compose.yml",
  "dockerfile",
  "eslint.config.mjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "package.json",
  "pnpm-workspace.yaml",
  "pubspec.yaml",
  "pyproject.toml",
  "requirements.txt",
  "tailwind.config.js",
  "tailwind.config.ts",
  "tsconfig.json",
  "vite.config.ts",
]);

interface ScannedFile {
  relativePath: string;
  name: string;
  extension: string;
  size: number;
}

interface ScanInventory {
  files: ScannedFile[];
  directories: string[];
  textByPath: Map<string, string>;
}

export interface DirectoryImportResult {
  name: string;
  description: string;
  tags: string[];
  teamMembers: string[];
  analysis: ProjectDirectoryAnalysis;
}

export async function analyzeProjectDirectory(directory: string): Promise<DirectoryImportResult> {
  const root = path.resolve(directory.trim());
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error("Path must be a directory");
  }

  const inventory = await scanDirectory(root);
  const packageJson = parseJson(inventory.textByPath.get("package.json"));
  const pubspec = inventory.textByPath.get("pubspec.yaml");
  const pyproject = inventory.textByPath.get("pyproject.toml");
  const cargo = inventory.textByPath.get("Cargo.toml") ?? inventory.textByPath.get("cargo.toml");
  const readme = findFirstText(inventory, /^readme\.(md|mdx|txt)$/i);
  const gitSignals = await inspectGit(root);

  const stack = detectStack(inventory, packageJson, pubspec, pyproject, cargo);
  const packageManagers = detectPackageManagers(inventory);
  const counts = countProjectSignals(inventory);
  const commands = detectCommands(packageJson, packageManagers);
  const category = detectCategory(stack, inventory);
  const stage = detectDevelopmentStage({ counts, commands, gitSignals, stack, inventory });
  const signals = buildSignals({ stack, packageManagers, commands, counts, gitSignals, readme });
  const risks = buildRisks({ counts, commands, gitSignals, inventory });
  const recommendations = buildRecommendations({ counts, commands, risks, stack, gitSignals, inventory });
  const notableFiles = getNotableFiles(inventory);
  const name = inferProjectName(root, packageJson);
  const tags = unique([
    category.toLowerCase().replace(/\s+/g, "-"),
    ...stack.map((item) => item.toLowerCase().replace(/[^a-z0-9]+/g, "-")).filter(Boolean),
    stage,
  ]).slice(0, 12);

  const summary = [
    `${name} appears to be a ${category.toLowerCase()} in ${stage.replace(/-/g, " ")}.`,
    stack.length ? `Primary stack: ${stack.slice(0, 8).join(", ")}.` : "No dominant framework was detected from common manifests.",
    `Scanned ${counts.filesScanned} files with ${counts.sourceFiles} source files, ${counts.testFiles} tests, ${counts.docsFiles} docs, and ${counts.todoMarkers} TODO/FIXME markers.`,
    gitSignals.branch ? `Git branch: ${gitSignals.branch}${gitSignals.dirty ? " with uncommitted changes" : ""}.` : "",
  ].filter(Boolean).join(" ");

  const analysis: ProjectDirectoryAnalysis = {
    sourceDirectory: root,
    scannedAt: new Date().toISOString(),
    category,
    developmentStage: stage,
    confidence: stack.length >= 2 && counts.filesScanned > 20 ? "high" : stack.length > 0 ? "medium" : "low",
    summary,
    stack,
    packageManagers,
    commands,
    counts,
    signals,
    risks,
    recommendations,
    notableFiles,
    generatedTasks: recommendations.slice(0, 8),
  };

  return {
    name,
    description: buildProjectDescription(analysis),
    tags,
    teamMembers: suggestTeamMembers(stack, risks),
    analysis,
  };
}

async function scanDirectory(root: string): Promise<ScanInventory> {
  const files: ScannedFile[] = [];
  const directories: string[] = [];
  const textByPath = new Map<string, string>();
  const queue = [root];
  let textFilesRead = 0;

  while (queue.length > 0 && files.length < MAX_FILES) {
    const current = queue.shift() as string;
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name.toLowerCase())) {
          directories.push(relativePath);
          queue.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile() || shouldSkipFile(entry.name) || files.length >= MAX_FILES) continue;

      const fileStat = await stat(absolutePath);
      const scannedFile = {
        relativePath,
        name: entry.name,
        extension: path.extname(entry.name).toLowerCase(),
        size: fileStat.size,
      };
      files.push(scannedFile);

      if (textFilesRead < MAX_TEXT_FILES && isTextCandidate(scannedFile) && fileStat.size <= MAX_FILE_BYTES) {
        try {
          textByPath.set(relativePath, await readFile(absolutePath, "utf-8"));
          textFilesRead++;
        } catch {
          // Binary or unreadable files are not needed for the analysis.
        }
      }
    }
  }

  return { files, directories, textByPath };
}

function shouldSkipFile(name: string): boolean {
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function isTextCandidate(file: ScannedFile): boolean {
  const lowerName = file.name.toLowerCase();
  return SOURCE_EXTENSIONS.has(file.extension) || DOC_EXTENSIONS.has(file.extension) || CONFIG_NAMES.has(lowerName);
}

function parseJson(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function findFirstText(inventory: ScanInventory, pattern: RegExp): string | undefined {
  for (const [relativePath, value] of inventory.textByPath.entries()) {
    if (pattern.test(path.basename(relativePath))) return value;
  }
  return undefined;
}

async function inspectGit(root: string): Promise<{ branch?: string; dirty: boolean; recentCommits: number }> {
  try {
    await access(path.join(root, ".git"));
  } catch {
    return { dirty: false, recentCommits: 0 };
  }

  try {
    const [{ stdout: branchOut }, { stdout: statusOut }, { stdout: logOut }] = await Promise.all([
      execFileAsync("git", ["-C", root, "branch", "--show-current"], { timeout: 2500 }),
      execFileAsync("git", ["-C", root, "status", "--porcelain"], { timeout: 2500 }),
      execFileAsync("git", ["-C", root, "log", "--since=30 days ago", "--oneline"], { timeout: 2500 }),
    ]);
    return {
      branch: branchOut.trim() || undefined,
      dirty: statusOut.trim().length > 0,
      recentCommits: logOut.split("\n").filter(Boolean).length,
    };
  } catch {
    return { dirty: false, recentCommits: 0 };
  }
}

function detectStack(
  inventory: ScanInventory,
  packageJson: Record<string, unknown> | null,
  pubspec?: string,
  pyproject?: string,
  cargo?: string,
): string[] {
  const deps = packageJson ? {
    ...asRecord(packageJson.dependencies),
    ...asRecord(packageJson.devDependencies),
  } : {};
  const fileNames = new Set(inventory.files.map((file) => file.name.toLowerCase()));
  const dirs = new Set(inventory.directories.map((dir) => dir.toLowerCase()));
  const stack: string[] = [];

  if (deps.next || fileNames.has("next.config.ts") || fileNames.has("next.config.js")) stack.push("Next.js");
  if (deps.react) stack.push("React");
  if (deps.vue) stack.push("Vue");
  if (deps.svelte) stack.push("Svelte");
  if (deps.vite || fileNames.has("vite.config.ts")) stack.push("Vite");
  if (deps.typescript || fileNames.has("tsconfig.json")) stack.push("TypeScript");
  if (deps.tailwindcss || Array.from(fileNames).some((name) => name.startsWith("tailwind.config"))) stack.push("Tailwind CSS");
  if (deps.vitest) stack.push("Vitest");
  if (deps.jest) stack.push("Jest");
  if (deps.playwright || deps["@playwright/test"]) stack.push("Playwright");
  if (pubspec || dirs.has("lib") && inventory.files.some((file) => file.extension === ".dart")) stack.push("Flutter/Dart");
  if (pyproject || fileNames.has("requirements.txt")) stack.push("Python");
  if (cargo) stack.push("Rust");
  if (inventory.files.some((file) => file.extension === ".swift")) stack.push("Swift");
  if (inventory.files.some((file) => file.extension === ".go")) stack.push("Go");
  if (fileNames.has("dockerfile") || fileNames.has("docker-compose.yml")) stack.push("Docker");
  if (dirs.has("android")) stack.push("Android");
  if (dirs.has("ios")) stack.push("iOS");

  return unique(stack);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function detectPackageManagers(inventory: ScanInventory): string[] {
  const fileNames = new Set(inventory.files.map((file) => file.name.toLowerCase()));
  const managers: string[] = [];
  if (fileNames.has("pnpm-lock.yaml")) managers.push("pnpm");
  if (fileNames.has("yarn.lock")) managers.push("yarn");
  if (fileNames.has("package-lock.json")) managers.push("npm");
  if (fileNames.has("bun.lockb") || fileNames.has("bun.lock")) managers.push("bun");
  if (fileNames.has("pubspec.lock")) managers.push("flutter pub");
  if (fileNames.has("poetry.lock")) managers.push("poetry");
  if (fileNames.has("cargo.lock")) managers.push("cargo");
  if (managers.length === 0 && fileNames.has("package.json")) managers.push("npm");
  return managers;
}

function detectCommands(packageJson: Record<string, unknown> | null, managers: string[]): ProjectDirectoryAnalysis["commands"] {
  const scripts = asRecord(packageJson?.scripts);
  const runner = managers[0] === "pnpm" ? "pnpm" : managers[0] === "yarn" ? "yarn" : managers[0] === "bun" ? "bun" : "npm run";
  const run = (script: string) => runner === "npm run" ? `npm run ${script}` : `${runner} ${script}`;
  return {
    install: managers[0] ? `${managers[0]} install` : undefined,
    dev: scripts.dev ? run("dev") : scripts.start ? run("start") : undefined,
    build: scripts.build ? run("build") : undefined,
    test: scripts.test ? run("test") : undefined,
    lint: scripts.lint ? run("lint") : undefined,
  };
}

function countProjectSignals(inventory: ScanInventory): ProjectDirectoryAnalysis["counts"] {
  const testPattern = /(^|[./_-])(test|spec|__tests__)([./_-]|$)/i;
  let todoMarkers = 0;
  for (const text of inventory.textByPath.values()) {
    todoMarkers += text.match(/\b(TODO|FIXME|HACK|XXX)\b/g)?.length ?? 0;
  }
  return {
    filesScanned: inventory.files.length,
    directoriesScanned: inventory.directories.length,
    sourceFiles: inventory.files.filter((file) => SOURCE_EXTENSIONS.has(file.extension)).length,
    testFiles: inventory.files.filter((file) => testPattern.test(file.relativePath)).length,
    docsFiles: inventory.files.filter((file) => DOC_EXTENSIONS.has(file.extension)).length,
    configFiles: inventory.files.filter((file) => CONFIG_NAMES.has(file.name.toLowerCase())).length,
    todoMarkers,
  };
}

function detectCategory(stack: string[], inventory: ScanInventory): string {
  const dirs = new Set(inventory.directories.map((dir) => dir.toLowerCase()));
  if (stack.includes("Flutter/Dart") || dirs.has("ios") || dirs.has("android")) return "Mobile app";
  if (stack.includes("Next.js") || stack.includes("React") || stack.includes("Vue") || stack.includes("Svelte")) return "Web app";
  if (dirs.has("api") || dirs.has("server") || dirs.has("backend")) return "Backend service";
  if (stack.includes("Python") || stack.includes("Rust") || stack.includes("Go")) return "Software project";
  return "Application project";
}

function detectDevelopmentStage(input: {
  counts: ProjectDirectoryAnalysis["counts"];
  commands: ProjectDirectoryAnalysis["commands"];
  gitSignals: { branch?: string; dirty: boolean; recentCommits: number };
  stack: string[];
  inventory: ScanInventory;
}): ProjectDevelopmentStage {
  const { counts, commands, gitSignals, inventory } = input;
  const hasCi = inventory.files.some((file) => file.relativePath.startsWith(".github/workflows/"));
  const hasReleaseDocs = inventory.files.some((file) => /changelog|release|deploy/i.test(file.relativePath));

  if (counts.sourceFiles < 8) return "discovery";
  if (!commands.build || counts.testFiles === 0) return "prototype";
  if (counts.testFiles > 0 && (counts.todoMarkers > 20 || gitSignals.dirty)) return "active-development";
  if (commands.test && commands.build && (hasCi || hasReleaseDocs) && counts.todoMarkers <= 5) return "launch-ready";
  if (commands.test && commands.build && counts.testFiles >= 3) return "qa-hardening";
  return "active-development";
}

function buildSignals(input: {
  stack: string[];
  packageManagers: string[];
  commands: ProjectDirectoryAnalysis["commands"];
  counts: ProjectDirectoryAnalysis["counts"];
  gitSignals: { branch?: string; dirty: boolean; recentCommits: number };
  readme?: string;
}): string[] {
  const signals = [
    input.stack.length ? `Detected stack: ${input.stack.join(", ")}` : "No common framework manifest detected",
    input.packageManagers.length ? `Package manager: ${input.packageManagers.join(", ")}` : "No package manager lockfile detected",
    input.commands.dev ? `Dev command available: ${input.commands.dev}` : "No dev command detected",
    input.commands.build ? `Build command available: ${input.commands.build}` : "No build command detected",
    input.commands.test ? `Test command available: ${input.commands.test}` : "No test command detected",
    input.counts.testFiles > 0 ? `${input.counts.testFiles} test files found` : "No obvious test files found",
    input.readme ? "README or primary docs found" : "No README found in scanned files",
  ];
  if (input.gitSignals.branch) signals.push(`Git branch ${input.gitSignals.branch}; ${input.gitSignals.recentCommits} commits in the last 30 days`);
  if (input.gitSignals.dirty) signals.push("Working tree has uncommitted changes");
  return signals;
}

function buildRisks(input: {
  counts: ProjectDirectoryAnalysis["counts"];
  commands: ProjectDirectoryAnalysis["commands"];
  gitSignals: { dirty: boolean };
  inventory: ScanInventory;
}): string[] {
  const risks: string[] = [];
  if (!input.commands.build) risks.push("No build script was detected, so release readiness is hard to verify.");
  if (!input.commands.test || input.counts.testFiles === 0) risks.push("Automated test coverage appears missing or minimal.");
  if (!input.commands.lint) risks.push("No lint script was detected for routine code-quality checks.");
  if (input.counts.todoMarkers > 20) risks.push(`${input.counts.todoMarkers} TODO/FIXME markers suggest unresolved implementation work.`);
  if (input.gitSignals.dirty) risks.push("Uncommitted changes may hide unfinished or unreviewed work.");
  if (!input.inventory.files.some((file) => /^readme\./i.test(file.name))) risks.push("Project documentation is not obvious from the root scan.");
  return risks.length ? risks : ["No major structural risks were detected by the local scan."];
}

function buildRecommendations(input: {
  counts: ProjectDirectoryAnalysis["counts"];
  commands: ProjectDirectoryAnalysis["commands"];
  risks: string[];
  stack: string[];
  gitSignals: { dirty: boolean };
  inventory: ScanInventory;
}): string[] {
  const recommendations: string[] = [];
  if (input.commands.build) recommendations.push(`Run and record the current build result with ${input.commands.build}.`);
  else recommendations.push("Define a repeatable build command for this project.");
  if (input.commands.test) recommendations.push(`Run the test suite and capture failures with ${input.commands.test}.`);
  else recommendations.push("Add a baseline automated test command and at least one smoke test.");
  if (!input.commands.lint) recommendations.push("Add a lint or static analysis command for routine quality gates.");
  if (input.counts.todoMarkers > 0) recommendations.push("Triage TODO/FIXME markers into explicit Mission Control tasks.");
  if (input.gitSignals.dirty) recommendations.push("Review uncommitted Git changes and split them into clear commits or tasks.");
  if (input.stack.includes("Next.js") || input.stack.includes("React")) recommendations.push("Verify the main user flows across desktop and mobile viewports.");
  if (input.stack.includes("Flutter/Dart")) recommendations.push("Run mobile smoke tests on the target iOS and Android environments.");
  if (!input.inventory.files.some((file) => /^readme\./i.test(file.name))) recommendations.push("Create a README with setup, environment, and release instructions.");
  return unique(recommendations).slice(0, 10);
}

function getNotableFiles(inventory: ScanInventory): string[] {
  return inventory.files
    .filter((file) => {
      const name = file.name.toLowerCase();
      return CONFIG_NAMES.has(name) || /^readme\./i.test(file.name) || /test|spec|todo|roadmap|changelog|release/i.test(file.relativePath);
    })
    .map((file) => file.relativePath)
    .slice(0, 40);
}

function inferProjectName(root: string, packageJson: Record<string, unknown> | null): string {
  const packageName = typeof packageJson?.name === "string" ? packageJson.name : "";
  return (packageName || path.basename(root)).replace(/^@[^/]+\//, "");
}

function buildProjectDescription(analysis: ProjectDirectoryAnalysis): string {
  const riskSummary = analysis.risks.slice(0, 3).join(" ");
  const nextSteps = analysis.recommendations.slice(0, 3).join(" ");
  return `${analysis.summary}\n\nScan risks: ${riskSummary}\n\nRecommended next steps: ${nextSteps}`;
}

function suggestTeamMembers(stack: string[], risks: string[]): string[] {
  const members = new Set(["me", "developer"]);
  if (risks.some((risk) => /documentation|README|release/i.test(risk))) members.add("researcher");
  if (stack.some((item) => /web|react|next|flutter|mobile/i.test(item))) members.add("business-analyst");
  return Array.from(members);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
