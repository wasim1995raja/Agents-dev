import type { CommandVerdict } from "./types.js";

/**
 * A deliberately conservative command policy. It is enforced on the host before
 * anything reaches Docker, and Docker itself is the second layer of defence.
 *
 * Decisions:
 *  - deny               → never executed
 *  - requires_approval  → persisted approval request, execution waits
 *  - allow              → executed inside the project container
 */

const FORBIDDEN_BINARIES = new Set([
  "sudo",
  "su",
  "doas",
  "mount",
  "umount",
  "systemctl",
  "service",
  "reboot",
  "shutdown",
  "poweroff",
  "iptables",
  "nft",
  "insmod",
  "modprobe",
  "mknod",
  "nsenter",
  "unshare",
  "docker",
  "podman",
  "kubectl",
  "minikube",
  "chroot",
  "pivot_root",
  "sysctl",
  "crontab",
  "at",
]);

const DESTRUCTIVE_BINARIES = new Set(["rm", "rmdir", "shred", "dd", "mkfs", "fdisk", "parted", "wipefs"]);

const PACKAGE_MANAGER_PATTERN =
  /^(npm|pnpm|yarn|bun)\s+(install|i|add|ci|update|upgrade|remove|rm|uninstall)\b/;
const PYTHON_PATTERN = /^(pip3?|uv|poetry|pipx)\s+(install|add|sync|lock|remove)\b/;
const SYSTEM_PKG_PATTERN = /^(apt|apt-get|apk|dnf|yum|pacman|zypper)\s+(install|add|remove|upgrade|update)\b/;

const BUILD_ARTIFACT_TARGETS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "tmp",
  ".cache",
  "test-results",
  "playwright-report",
]);

const SAFE_MAX_LENGTH = 2000;

export function splitCommandSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||;|\n|\|)/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** Strips leading `FOO=bar` assignments and returns the executable + args. */
export function parseSegment(segment: string): { binary: string; args: string[] } {
  const tokens = tokenize(segment);
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) {
    index += 1;
  }
  const binary = (tokens[index] ?? "").split("/").pop() ?? "";
  return { binary, args: tokens.slice(index + 1) };
}

/** Minimal shell tokenizer: honours single/double quotes, no expansions. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let hasToken = false;

  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i] ?? "";
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === " " || char === "\t") {
      if (hasToken || current.length > 0) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken || current.length > 0) tokens.push(current);
  return tokens;
}

function isDangerousTarget(target: string): boolean {
  const normalized = target.replace(/^['"]|['"]$/g, "");
  if (normalized === "/" || normalized === "/*" || normalized === "~" || normalized === "$HOME") {
    return true;
  }
  if (normalized.startsWith("/")) return true;
  if (normalized.includes("..")) return true;
  return false;
}

function classifyDestructive(binary: string, args: string[]): CommandVerdict {
  const targets = args.filter((arg) => !arg.startsWith("-"));

  if (binary === "dd") {
    const writesToDevice = args.some((arg) => /^of=\/dev\//.test(arg));
    if (writesToDevice) {
      return { decision: "deny", category: "blocked", reason: "dd writes to a device node" };
    }
    return {
      decision: "requires_approval",
      category: "destructive_command",
      reason: "dd can overwrite data",
    };
  }

  if (targets.some(isDangerousTarget)) {
    return {
      decision: "deny",
      category: "blocked",
      reason: `${binary} targets a path outside the workspace`,
    };
  }

  if (binary === "rm" || binary === "rmdir" || binary === "shred") {
    const onlyArtifacts =
      targets.length > 0 &&
      targets.every((target) => {
        const clean = target.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
        return BUILD_ARTIFACT_TARGETS.has(clean);
      });
    if (onlyArtifacts) {
      return {
        decision: "allow",
        reason: "removing known build artifacts inside the workspace",
      };
    }
    return {
      decision: "requires_approval",
      category: "destructive_command",
      reason: "filesystem deletion requires owner approval",
    };
  }

  return {
    decision: "requires_approval",
    category: "destructive_command",
    reason: `${binary} is a destructive operation`,
  };
}

export function classifyCommand(command: string): CommandVerdict {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { decision: "deny", category: "blocked", reason: "empty command" };
  }
  if (trimmed.length > SAFE_MAX_LENGTH) {
    return { decision: "deny", category: "blocked", reason: "command exceeds the length limit" };
  }
  if (/[\u0000\u0008]/.test(trimmed)) {
    return { decision: "deny", category: "blocked", reason: "command contains control characters" };
  }

  const segments = splitCommandSegments(trimmed);
  if (segments.length === 0) {
    return { decision: "deny", category: "blocked", reason: "no executable found" };
  }

  if (/\b(curl|wget)\b[\s\S]*\|\s*(sh|bash|zsh|node|python3?)\b/i.test(trimmed)) {
    return {
      decision: "requires_approval",
      category: "destructive_command",
      reason: "piping remote content into an interpreter requires approval",
    };
  }

  let pendingApproval: CommandVerdict | null = null;

  for (const segment of segments) {
    const { binary, args } = parseSegment(segment);
    if (!binary) {
      return { decision: "deny", category: "blocked", reason: "no executable found" };
    }

    if (FORBIDDEN_BINARIES.has(binary)) {
      return {
        decision: "deny",
        category: "blocked",
        reason: `${binary} is not permitted inside the sandbox`,
      };
    }

    if (binary === "kill") {
      if (args.some((arg) => arg === "1" || arg === "-1")) {
        return { decision: "deny", category: "blocked", reason: "refusing to kill init" };
      }
      pendingApproval ??= {
        decision: "requires_approval",
        category: "destructive_command",
        reason: "killing processes requires owner approval",
      };
      continue;
    }

    if (binary === "chmod" || binary === "chown") {
      if (args.some((arg) => arg === "/" || arg.startsWith("/etc") || arg.startsWith("/usr"))) {
        return {
          decision: "deny",
          category: "blocked",
          reason: `${binary} on system paths is blocked`,
        };
      }
    }

    if (DESTRUCTIVE_BINARIES.has(binary)) {
      const verdict = classifyDestructive(binary, args);
      if (verdict.decision === "deny") return verdict;
      if (verdict.decision === "requires_approval") pendingApproval ??= verdict;
      continue;
    }

    if (binary === "git") {
      const joined = args.join(" ");
      if (
        /^reset\s+--hard\b/.test(joined) ||
        /^clean\s+-[a-zA-Z]*f/.test(joined) ||
        /^push\s+.*(--force|-f)\b/.test(joined) ||
        /^checkout\s+--\s+\./.test(joined)
      ) {
        pendingApproval ??= {
          decision: "requires_approval",
          category: "destructive_command",
          reason: "destructive git operation requires owner approval",
        };
        continue;
      }
    }

    const lowerSegment = segment.toLowerCase();
    if (
      /\b(curl|wget)\b/.test(lowerSegment) &&
      /\|\s*(sh|bash|zsh|node|python3?)\b/.test(lowerSegment)
    ) {
      pendingApproval ??= {
        decision: "requires_approval",
        category: "destructive_command",
        reason: "piping remote content into an interpreter requires approval",
      };
      continue;
    }

    if (
      PACKAGE_MANAGER_PATTERN.test(segment) ||
      PYTHON_PATTERN.test(segment) ||
      SYSTEM_PKG_PATTERN.test(segment)
    ) {
      pendingApproval ??= {
        decision: "requires_approval",
        category: "dependency_install",
        reason: "dependency installation requires owner approval",
      };
      continue;
    }
  }

  if (pendingApproval) return pendingApproval;
  return { decision: "allow", reason: "command allowed by policy" };
}
