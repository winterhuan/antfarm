/**
 * Step Template Module
 *
 * Template resolution, variable substitution, and frontend change detection.
 * Approximately 150 lines.
 */

/**
 * Resolve {{key}} placeholders in a template against a context object.
 * Supports case-insensitive matching and nested dot notation.
 */
export function resolveTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
    if (key in context) return context[key];
    const lower = key.toLowerCase();
    if (lower in context) return context[lower];
    return `[missing: ${key}]`;
  });
}

/**
 * Find missing template placeholders for a given context object.
 * Returns list of keys that are referenced in template but not present in context.
 */
export function findMissingTemplateKeys(template: string, context: Record<string, string>): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();

  template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
    const lower = key.toLowerCase();
    const hasExact = Object.prototype.hasOwnProperty.call(context, key);
    const hasLower = Object.prototype.hasOwnProperty.call(context, lower);
    if (!hasExact && !hasLower && !seen.has(lower)) {
      seen.add(lower);
      missing.push(lower);
    }
    return "";
  });

  return missing;
}

/**
 * Check if a file path indicates a frontend change.
 * Frontend files include: .tsx, .jsx, .css, .scss, .html, .vue, .svelte,
 * and files in frontend-related directories.
 */
function isFrontendFile(file: string): boolean {
  const frontendExtensions = new Set([
    ".tsx", ".jsx", ".css", ".scss", ".sass", ".less",
    ".html", ".htm", ".vue", ".svelte", ".astro"
  ]);

  const frontendDirs = new Set([
    "components", "pages", "views", "ui", "frontend", "client",
    "src/app", "src/routes", "src/components", "src/pages"
  ]);

  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (frontendExtensions.has(ext)) return true;

  const lowerPath = file.toLowerCase();
  for (const dir of frontendDirs) {
    if (lowerPath.includes(dir)) return true;
  }

  return false;
}

/**
 * Compute whether a list of files contains frontend changes.
 * Returns boolean indicating if any file is a frontend file.
 */
export function computeHasFrontendChanges(files: string[]): boolean {
  return files.some(isFrontendFile);
}
