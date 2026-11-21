import type { ProviderCredentialField } from "./types";

export function findCredentialValueIssue(input: {
  providerLabel: string;
  fields: readonly ProviderCredentialField[];
  values: Readonly<Record<string, string>>;
}): string | null {
  for (const field of input.fields) {
    const submittedValue = (input.values[field.key] ?? "").trim();
    if (!submittedValue) {
      if (field.required) {
        return `Field "${field.key}" is required for ${input.providerLabel}.`;
      }
      continue;
    }
    if (field.kind === "url" && !isHttpsUrl(submittedValue)) {
      return `Field "${field.key}" must be an https:// URL for ${input.providerLabel}.`;
    }
  }
  return null;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
