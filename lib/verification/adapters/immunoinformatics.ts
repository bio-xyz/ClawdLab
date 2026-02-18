/**
 * Immunoinformatics Domain Adapter
 *
 * Verifies claims about epitope predictions, MHC binding affinities,
 * and B-cell epitopes using IEDB, UniProt, and sequence analysis.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";
import { inferClaimType } from "../infer";
import { fetchJson, fetchText } from "../utils/http-client";

const DOMAIN = "immunoinformatics";
const VALID_CLAIM_TYPES = ["epitope_prediction", "mhc_binding", "bcell_epitope"] as const;

const UNIPROT_API = "https://rest.uniprot.org/uniprotkb";
const IEDB_API = "http://tools-cluster-interface.iedb.org/tools_api";

const STANDARD_AAS = new Set("ACDEFGHIKLMNPQRSTVWY".split(""));

// Kyte-Doolittle hydrophobicity scale
const KD_HYDROPHOBICITY: Record<string, number> = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5,
  E: -3.5, Q: -3.5, G: -0.4, H: -3.2, I: 4.5,
  L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6,
  S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isValidPeptide(seq: string): boolean {
  return seq.length > 0 && [...seq.toUpperCase()].every((c) => STANDARD_AAS.has(c));
}

function avgHydrophobicity(seq: string): number {
  const chars = [...seq.toUpperCase()];
  if (chars.length === 0) return 0;
  const sum = chars.reduce((s, c) => s + (KD_HYDROPHOBICITY[c] ?? 0), 0);
  return sum / chars.length;
}

function checkAlleleFormat(allele: string): number {
  // Strict HLA format: HLA-A*02:01 etc.
  const strict = /^HLA-[A-Z]+\d?\*\d{2,4}:\d{2,4}$/;
  if (strict.test(allele)) return 1.0;
  // Relaxed: HLA-A2, HLA-DRB1*01:01 etc.
  const relaxed = /^HLA-[A-Z]+/i;
  if (relaxed.test(allele)) return 0.7;
  return 0.3;
}

// ── Epitope Prediction ───────────────────────────────────────────────────

async function verifyEpitopePrediction(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const peptide = str(taskResult.peptide || taskResult.sequence).toUpperCase();
  const proteinId = str(taskResult.protein_id || taskResult.uniprot_id || taskResult.source_protein);
  const allele = str(taskResult.allele || taskResult.hla_allele);

  // Component 1: peptide_valid (0.15)
  if (peptide) {
    const valid = isValidPeptide(peptide);
    const lengthOk = peptide.length >= 8 && peptide.length <= 15;
    if (valid && lengthOk) {
      componentScores.peptide_valid = 1.0;
    } else if (valid) {
      componentScores.peptide_valid = 0.5;
      warnings.push(`Peptide length ${peptide.length} outside typical 8-15 range`);
    } else {
      componentScores.peptide_valid = 0.0;
      errors.push("Peptide contains non-standard amino acids");
    }
    details.peptide = { sequence: peptide, length: peptide.length, valid, length_ok: lengthOk };
  } else {
    componentScores.peptide_valid = 0.0;
    errors.push("No peptide sequence provided");
    details.peptide = { note: "Missing" };
  }

  // Component 2: source_protein_valid (0.20)
  if (proteinId) {
    const res = await fetchJson<Record<string, unknown>>(
      `${UNIPROT_API}/${encodeURIComponent(proteinId)}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok && res.data) {
      componentScores.source_protein_valid = 1.0;
      details.source_protein = { id: proteinId, found: true, name: res.data.proteinDescription };
    } else {
      componentScores.source_protein_valid = 0.0;
      details.source_protein = { id: proteinId, found: false };
      errors.push(`UniProt entry ${proteinId} not found`);
    }
  } else {
    componentScores.source_protein_valid = 0.5;
    details.source_protein = { note: "No protein ID provided" };
  }

  // Component 3: peptide_in_source (0.20)
  if (peptide && proteinId) {
    const fastaRes = await fetchText(
      `${UNIPROT_API}/${encodeURIComponent(proteinId)}.fasta`,
    );
    if (fastaRes.ok && fastaRes.text) {
      const seqLines = fastaRes.text.split("\n").filter((l) => !l.startsWith(">"));
      const fullSeq = seqLines.join("").toUpperCase();
      const found = fullSeq.includes(peptide);
      componentScores.peptide_in_source = found ? 1.0 : 0.0;
      details.peptide_in_source = { found, protein_length: fullSeq.length };
      if (!found) warnings.push("Peptide not found in source protein sequence");
    } else {
      componentScores.peptide_in_source = 0.5;
      details.peptide_in_source = { note: "Could not fetch FASTA" };
      warnings.push("Failed to retrieve protein FASTA for peptide matching");
    }
  } else {
    componentScores.peptide_in_source = 0.5;
    details.peptide_in_source = { note: "Need both peptide and protein ID" };
  }

  // Component 4: iedb_score_check (0.25)
  if (peptide && allele) {
    const formBody = new URLSearchParams({
      method: "recommended",
      sequence_text: peptide,
      allele: allele,
      length: String(peptide.length),
    });
    const iedbRes = await fetchJson<unknown>(
      `${IEDB_API}/mhci/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      },
    );
    if (iedbRes.ok && iedbRes.data) {
      componentScores.iedb_score_check = 0.8;
      details.iedb_prediction = { success: true, note: "IEDB prediction returned data" };
    } else {
      componentScores.iedb_score_check = 0.5;
      details.iedb_prediction = { success: false, error: iedbRes.error };
      warnings.push("IEDB MHC-I prediction did not return usable data");
    }
  } else {
    componentScores.iedb_score_check = 0.5;
    details.iedb_prediction = { note: "Need peptide and allele for IEDB check" };
  }

  // Component 5: allele_valid (0.20)
  if (allele) {
    componentScores.allele_valid = checkAlleleFormat(allele);
    details.allele = { value: allele, score: componentScores.allele_valid };
  } else {
    componentScores.allele_valid = 0.5;
    details.allele = { note: "No allele provided" };
  }

  const weights: Record<string, number> = {
    peptide_valid: 0.15,
    source_protein_valid: 0.20,
    peptide_in_source: 0.20,
    iedb_score_check: 0.25,
    allele_valid: 0.20,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── MHC Binding ──────────────────────────────────────────────────────────

async function verifyMhcBinding(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const peptide = str(taskResult.peptide || taskResult.sequence).toUpperCase();
  const allele = str(taskResult.allele || taskResult.hla_allele);
  const mhcClass = str(taskResult.mhc_class || taskResult.class).toLowerCase();
  const ic50 = num(taskResult.ic50 ?? taskResult.binding_affinity, NaN);
  const classification = str(taskResult.classification || taskResult.binding_level).toLowerCase();

  // Component 1: allele_valid (0.20)
  if (allele) {
    componentScores.allele_valid = checkAlleleFormat(allele);
    details.allele = { value: allele, score: componentScores.allele_valid };
  } else {
    componentScores.allele_valid = 0.0;
    errors.push("No allele provided");
    details.allele = { note: "Missing" };
  }

  // Component 2: peptide_length_valid (0.15)
  if (peptide) {
    const len = peptide.length;
    const isClassI = mhcClass === "i" || mhcClass === "mhc-i" || mhcClass === "class_i" || mhcClass === "1" || !mhcClass;
    const isClassII = mhcClass === "ii" || mhcClass === "mhc-ii" || mhcClass === "class_ii" || mhcClass === "2";

    let lengthValid = false;
    if (isClassII) {
      lengthValid = len >= 13 && len <= 25;
    } else {
      // Default to class I
      lengthValid = len >= 8 && len <= 11;
    }

    const isValidAA = isValidPeptide(peptide);
    if (isValidAA && lengthValid) {
      componentScores.peptide_length_valid = 1.0;
    } else if (isValidAA) {
      componentScores.peptide_length_valid = 0.4;
      warnings.push(`Peptide length ${len} outside expected range for MHC class ${isClassII ? "II" : "I"}`);
    } else {
      componentScores.peptide_length_valid = 0.0;
      errors.push("Peptide contains non-standard amino acids");
    }
    details.peptide = { sequence: peptide, length: len, valid_aa: isValidAA, length_valid: lengthValid };
  } else {
    componentScores.peptide_length_valid = 0.0;
    errors.push("No peptide provided");
    details.peptide = { note: "Missing" };
  }

  // Component 3: binding_affinity_recomputed (0.35)
  if (peptide && allele) {
    const isClassII = mhcClass === "ii" || mhcClass === "mhc-ii" || mhcClass === "class_ii" || mhcClass === "2";
    const endpoint = isClassII ? "mhcii" : "mhci";

    const formBody = new URLSearchParams({
      method: "recommended",
      sequence_text: peptide,
      allele: allele,
      length: String(peptide.length),
    });

    const iedbRes = await fetchJson<unknown>(
      `${IEDB_API}/${endpoint}/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      },
    );

    if (iedbRes.ok && iedbRes.data && Number.isFinite(ic50)) {
      // Parse IEDB result for IC50 if available
      let predictedIc50 = NaN;
      if (typeof iedbRes.data === "string") {
        const lines = (iedbRes.data as string).split("\n");
        for (const line of lines) {
          const fields = line.split("\t");
          // IEDB typically returns IC50 in the last column
          const lastVal = Number(fields[fields.length - 1]);
          if (Number.isFinite(lastVal) && lastVal > 0) {
            predictedIc50 = lastVal;
            break;
          }
        }
      }

      if (Number.isFinite(predictedIc50) && predictedIc50 > 0) {
        // Compare on log scale -- within 0.5 orders of magnitude
        const logDiff = Math.abs(Math.log10(ic50) - Math.log10(predictedIc50));
        if (logDiff <= 0.5) {
          componentScores.binding_affinity_recomputed = 1.0;
        } else if (logDiff <= 1.0) {
          componentScores.binding_affinity_recomputed = 0.6;
        } else {
          componentScores.binding_affinity_recomputed = 0.2;
        }
        details.binding_affinity = { claimed_ic50: ic50, predicted_ic50: predictedIc50, log_diff: round4(logDiff) };
      } else {
        componentScores.binding_affinity_recomputed = 0.5;
        details.binding_affinity = { note: "IEDB returned data but could not extract IC50" };
      }
    } else {
      componentScores.binding_affinity_recomputed = 0.5;
      details.binding_affinity = { note: "IEDB prediction unavailable or no IC50 claimed", error: iedbRes.error };
      warnings.push("Could not recompute binding affinity via IEDB");
    }
  } else {
    componentScores.binding_affinity_recomputed = 0.5;
    details.binding_affinity = { note: "Need peptide and allele for binding prediction" };
  }

  // Component 4: classification_consistent (0.30)
  if (Number.isFinite(ic50) && classification) {
    let expectedClass = "";
    if (ic50 <= 50) expectedClass = "strong";
    else if (ic50 <= 500) expectedClass = "weak";
    else expectedClass = "non-binder";

    const normClassification = classification.replace(/[_-\s]/g, "").toLowerCase();
    const normExpected = expectedClass.replace(/[_-\s]/g, "").toLowerCase();

    if (normClassification.includes(normExpected) || normExpected.includes(normClassification)) {
      componentScores.classification_consistent = 1.0;
    } else {
      componentScores.classification_consistent = 0.2;
      warnings.push(`IC50=${ic50} nM suggests "${expectedClass}" but claimed "${classification}"`);
    }
    details.classification = { ic50, expected: expectedClass, claimed: classification, consistent: componentScores.classification_consistent >= 0.8 };
  } else if (Number.isFinite(ic50)) {
    componentScores.classification_consistent = 0.5;
    details.classification = { note: "No classification claimed to verify" };
  } else {
    componentScores.classification_consistent = 0.5;
    details.classification = { note: "No IC50 provided for classification check" };
  }

  const weights: Record<string, number> = {
    allele_valid: 0.20,
    peptide_length_valid: 0.15,
    binding_affinity_recomputed: 0.35,
    classification_consistent: 0.30,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── B-Cell Epitope ───────────────────────────────────────────────────────

async function verifyBcellEpitope(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const sequence = str(taskResult.sequence || taskResult.peptide || taskResult.epitope).toUpperCase();
  const proteinId = str(taskResult.protein_id || taskResult.uniprot_id || taskResult.source_protein);

  // Component 1: sequence_valid (0.15)
  if (sequence) {
    const valid = isValidPeptide(sequence);
    const lengthOk = sequence.length >= 5 && sequence.length <= 50;
    if (valid && lengthOk) {
      componentScores.sequence_valid = 1.0;
    } else if (valid) {
      componentScores.sequence_valid = 0.5;
      warnings.push(`B-cell epitope length ${sequence.length} outside typical 5-50 range`);
    } else {
      componentScores.sequence_valid = 0.0;
      errors.push("Sequence contains non-standard amino acids");
    }
    details.sequence = { value: sequence, length: sequence.length, valid, length_ok: lengthOk };
  } else {
    componentScores.sequence_valid = 0.0;
    errors.push("No sequence provided");
    details.sequence = { note: "Missing" };
  }

  // Component 2: source_protein_valid (0.20)
  if (proteinId) {
    const res = await fetchJson<Record<string, unknown>>(
      `${UNIPROT_API}/${encodeURIComponent(proteinId)}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok && res.data) {
      componentScores.source_protein_valid = 1.0;
      details.source_protein = { id: proteinId, found: true };
    } else {
      componentScores.source_protein_valid = 0.0;
      details.source_protein = { id: proteinId, found: false };
      errors.push(`UniProt entry ${proteinId} not found`);
    }
  } else {
    componentScores.source_protein_valid = 0.5;
    details.source_protein = { note: "No protein ID provided" };
  }

  // Component 3: surface_accessibility (0.25)
  if (sequence) {
    const hydro = avgHydrophobicity(sequence);
    if (hydro < -1) {
      componentScores.surface_accessibility = 1.0;
    } else if (hydro < 0) {
      componentScores.surface_accessibility = 0.7;
    } else if (hydro < 1) {
      componentScores.surface_accessibility = 0.4;
    } else {
      componentScores.surface_accessibility = 0.2;
    }
    details.surface_accessibility = {
      avg_hydrophobicity: round4(hydro),
      score: componentScores.surface_accessibility,
      note: "Kyte-Doolittle scale; lower = more hydrophilic = more surface accessible",
    };
  } else {
    componentScores.surface_accessibility = 0.5;
    details.surface_accessibility = { note: "No sequence for hydrophobicity analysis" };
  }

  // Component 4: iedb_bcell_check (0.25)
  if (sequence) {
    const formBody = new URLSearchParams({
      method: "Bepipred",
      sequence_text: sequence,
    });
    const iedbRes = await fetchJson<unknown>(
      `${IEDB_API}/bcell/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      },
    );
    if (iedbRes.ok && iedbRes.data) {
      componentScores.iedb_bcell_check = 0.8;
      details.iedb_bcell = { success: true };
    } else {
      componentScores.iedb_bcell_check = 0.5;
      details.iedb_bcell = { success: false, error: iedbRes.error };
      warnings.push("IEDB B-cell prediction did not return usable data");
    }
  } else {
    componentScores.iedb_bcell_check = 0.5;
    details.iedb_bcell = { note: "No sequence for IEDB B-cell prediction" };
  }

  // Component 5: conservation_check (0.15)
  if (proteinId) {
    const res = await fetchJson<Record<string, unknown>>(
      `${UNIPROT_API}/${encodeURIComponent(proteinId)}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok && res.data) {
      const xrefs = res.data.uniProtKBCrossReferences;
      let orthologDbs = 0;
      if (Array.isArray(xrefs)) {
        const orthologDbNames = new Set(["OrthoDB", "OMA", "InParanoid"]);
        for (const xref of xrefs) {
          const db = (xref as Record<string, unknown>).database;
          if (typeof db === "string" && orthologDbNames.has(db)) {
            orthologDbs++;
          }
        }
      }
      if (orthologDbs >= 2) {
        componentScores.conservation_check = 1.0;
      } else if (orthologDbs === 1) {
        componentScores.conservation_check = 0.7;
      } else {
        componentScores.conservation_check = 0.4;
      }
      details.conservation = { ortholog_databases: orthologDbs };
    } else {
      componentScores.conservation_check = 0.5;
      details.conservation = { note: "Could not fetch UniProt data for conservation" };
    }
  } else {
    componentScores.conservation_check = 0.5;
    details.conservation = { note: "No protein ID for conservation check" };
  }

  const weights: Record<string, number> = {
    sequence_valid: 0.15,
    source_protein_valid: 0.20,
    surface_accessibility: 0.25,
    iedb_bcell_check: 0.25,
    conservation_check: 0.15,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Adapter Export ────────────────────────────────────────────────────────

export const immunoinformaticsAdapter: DomainAdapter = {
  domain: DOMAIN,

  async verify(taskResult, taskMetadata): Promise<VerificationResult> {
    const start = performance.now();
    let claimType = str(taskResult.claim_type || taskMetadata.claim_type);
    const inferWarnings: string[] = [];

    if (!claimType) {
      const inferred = inferClaimType(DOMAIN, taskResult);
      if (inferred) {
        claimType = inferred;
        inferWarnings.push(`claim_type not provided — inferred as '${inferred}' from result fields`);
      } else {
        return failResult(DOMAIN, [
          `Missing claim_type and could not infer from result fields. Valid claim types: ${VALID_CLAIM_TYPES.join(", ")}`,
        ]);
      }
    }

    try {
      let result: { score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] };

      switch (claimType) {
        case "epitope_prediction":
          result = await verifyEpitopePrediction(taskResult);
          break;
        case "mhc_binding":
          result = await verifyMhcBinding(taskResult);
          break;
        case "bcell_epitope":
          result = await verifyBcellEpitope(taskResult);
          break;
        default:
          return failResult(DOMAIN, [
            `Unsupported immunoinformatics claim type: '${claimType}'. Valid types: ${VALID_CLAIM_TYPES.join(", ")}`,
          ]);
      }

      const elapsed = (performance.now() - start) / 1000;
      return successResult(DOMAIN, result.score, { claim_type: claimType, ...result.details }, {
        warnings: [...inferWarnings, ...result.warnings],
        errors: result.errors,
        compute_time_seconds: elapsed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return failResult(DOMAIN, [`Immunoinformatics verification failed: ${message}`]);
    }
  },
};
