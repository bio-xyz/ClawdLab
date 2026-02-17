/**
 * Verification dispatcher.
 *
 * Registry of domain adapters + dispatchVerification() entry point.
 */
import type { DomainAdapter, VerificationResult } from "./types";
import { failResult } from "./types";
import { SUPPORTED_DOMAINS, DEFERRED_DOMAINS } from "./domain-weights";

// ── Adapter imports ────────────────────────────────────────────────────────
import { genomicsAdapter } from "./adapters/genomics";
import { systemsBiologyAdapter } from "./adapters/systems-biology";
import { immunoinformaticsAdapter } from "./adapters/immunoinformatics";
import { metabolomicsAdapter } from "./adapters/metabolomics";
import { bioinformaticsAdapter } from "./adapters/bioinformatics";
import { epidemiologyAdapter } from "./adapters/epidemiology";
import { physicsAdapter } from "./adapters/physics";
import { mlAiAdapter } from "./adapters/ml-ai";
import { computationalBiologyAdapter } from "./adapters/computational-biology";

// ── Registry ──────────────────────────────────────────────────────────────

const ADAPTER_REGISTRY: Map<string, DomainAdapter> = new Map();

function register(adapter: DomainAdapter) {
  ADAPTER_REGISTRY.set(adapter.domain, adapter);
}

register(genomicsAdapter);
register(systemsBiologyAdapter);
register(immunoinformaticsAdapter);
register(metabolomicsAdapter);
register(bioinformaticsAdapter);
register(epidemiologyAdapter);
register(physicsAdapter);
register(mlAiAdapter);
register(computationalBiologyAdapter);

// ── Public API ────────────────────────────────────────────────────────────

export function getAdapter(domain: string): DomainAdapter | null {
  return ADAPTER_REGISTRY.get(domain) ?? null;
}

export function listDomains(): string[] {
  return [...ADAPTER_REGISTRY.keys()];
}

/**
 * Dispatch verification to the appropriate domain adapter.
 */
export async function dispatchVerification(
  domain: string,
  taskResult: Record<string, unknown>,
  taskMetadata: Record<string, unknown>,
): Promise<VerificationResult> {
  if (domain === "general") {
    return failResult(domain, ["Domain 'general' has no adapter — verification requires a specific domain"]);
  }

  if (DEFERRED_DOMAINS.has(domain)) {
    return failResult(domain, [
      `Adapter for '${domain}' is deferred — requires Python-only libraries (${
        domain === "mathematics" ? "Lean4/Docker" :
        domain === "materials_science" ? "pymatgen" : "rdkit"
      })`,
    ]);
  }

  const adapter = ADAPTER_REGISTRY.get(domain);
  if (!adapter) {
    return failResult(domain, [`No adapter registered for domain: ${domain}`]);
  }

  try {
    return await adapter.verify(taskResult, taskMetadata);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return failResult(domain, [`Adapter crashed: ${message}`]);
  }
}
