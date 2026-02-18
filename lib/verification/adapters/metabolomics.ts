/**
 * Metabolomics Domain Adapter
 *
 * Verifies claims about compound identification, metabolic pathway mapping,
 * and spectral matching using HMDB, KEGG, PubChem, and MassBank APIs.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";
import { inferClaimType } from "../infer";
import { fetchJson, fetchText } from "../utils/http-client";

const DOMAIN = "metabolomics";
const VALID_CLAIM_TYPES = ["compound_identification", "pathway_mapping", "spectral_match"] as const;

const HMDB_API = "https://hmdb.ca/metabolites";
const PUBCHEM_API = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";
const KEGG_API = "https://rest.kegg.jp";
const MASSBANK_API = "https://massbank.eu/MassBank/rest";

const KNOWN_ADDUCTS = new Set([
  "[M+H]+", "[M-H]-", "[M+Na]+", "[M+K]+", "[M+NH4]+", "[M-H2O+H]+",
]);

const ADDUCT_SHIFTS: Record<string, number> = {
  "[M+H]+": 1.00728,
  "[M-H]-": -1.00728,
  "[M+Na]+": 22.9892,
  "[M+K]+": 38.9632,
  "[M+NH4]+": 18.0344,
  "[M-H2O+H]+": -17.0027,
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

/** Extract a value from XML text using a simple tag pattern. */
function xmlTagValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "").trim();
}

function ppmError(measured: number, theoretical: number): number {
  if (theoretical === 0) return Infinity;
  return Math.abs((measured - theoretical) / theoretical) * 1e6;
}

// ── Compound Identification ──────────────────────────────────────────────

async function verifyCompoundIdentification(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const hmdbId = str(taskResult.hmdb_id || taskResult.identifier);
  const inchikey = str(taskResult.inchikey || taskResult.inchi_key);
  const claimedName = str(taskResult.name || taskResult.compound_name);
  const claimedFormula = str(taskResult.formula || taskResult.molecular_formula);
  const claimedMz = num(taskResult.mz ?? taskResult.observed_mz, NaN);
  const adduct = str(taskResult.adduct || "[M+H]+");

  let hmdbXml: string | null = null;

  // Component 1: identifier_valid (0.20)
  if (hmdbId && hmdbId.startsWith("HMDB")) {
    const res = await fetchText(`${HMDB_API}/${encodeURIComponent(hmdbId)}.xml`);
    if (res.ok && res.text) {
      componentScores.identifier_valid = 1.0;
      hmdbXml = res.text;
      details.identifier = { id: hmdbId, source: "HMDB", found: true };
    } else {
      componentScores.identifier_valid = 0.0;
      details.identifier = { id: hmdbId, source: "HMDB", found: false };
      errors.push(`HMDB entry ${hmdbId} not found`);
    }
  } else if (inchikey) {
    const res = await fetchJson<Record<string, unknown>>(
      `${PUBCHEM_API}/inchikey/${encodeURIComponent(inchikey)}/property/MolecularFormula,MolecularWeight/JSON`,
    );
    if (res.ok && res.data) {
      componentScores.identifier_valid = 1.0;
      details.identifier = { id: inchikey, source: "PubChem", found: true };
    } else {
      componentScores.identifier_valid = 0.0;
      details.identifier = { id: inchikey, source: "PubChem", found: false };
      errors.push(`InChIKey ${inchikey} not found in PubChem`);
    }
  } else {
    componentScores.identifier_valid = 0.5;
    details.identifier = { note: "No HMDB ID or InChIKey provided" };
  }

  // Component 2: name_match (0.20)
  if (claimedName && hmdbXml) {
    const dbName = xmlTagValue(hmdbXml, "name");
    const iupacName = xmlTagValue(hmdbXml, "iupac_name");
    const tradName = xmlTagValue(hmdbXml, "traditional_iupac");

    const candidates = [dbName, iupacName, tradName].filter(Boolean) as string[];
    const match = candidates.some((c) => normalise(c) === normalise(claimedName));

    componentScores.name_match = match ? 1.0 : 0.3;
    details.name = { claimed: claimedName, db_names: candidates, match };
  } else {
    componentScores.name_match = 0.5;
    details.name = { note: "Cannot verify name (missing data or HMDB XML)" };
  }

  // Component 3: mass_match (0.25)
  if (Number.isFinite(claimedMz) && hmdbXml) {
    const monoMassStr = xmlTagValue(hmdbXml, "monisotopic_molecular_weight") ??
                        xmlTagValue(hmdbXml, "monoisotopic_molecular_weight");
    const monoMass = num(monoMassStr, NaN);

    if (Number.isFinite(monoMass) && monoMass > 0) {
      const shift = ADDUCT_SHIFTS[adduct] ?? ADDUCT_SHIFTS["[M+H]+"];
      const expectedMz = monoMass + shift;
      const ppm = ppmError(claimedMz, expectedMz);

      if (ppm <= 10) {
        componentScores.mass_match = 1.0;
      } else if (ppm <= 30) {
        componentScores.mass_match = 0.6;
        warnings.push(`Mass accuracy ${round4(ppm)} ppm (>10 ppm threshold)`);
      } else {
        componentScores.mass_match = 0.1;
        warnings.push(`Mass accuracy ${round4(ppm)} ppm is poor`);
      }
      details.mass = { claimed_mz: claimedMz, expected_mz: round4(expectedMz), adduct, ppm: round4(ppm), mono_mass: monoMass };
    } else {
      componentScores.mass_match = 0.5;
      details.mass = { note: "Could not extract monoisotopic mass from HMDB" };
    }
  } else {
    componentScores.mass_match = 0.5;
    details.mass = { note: "No m/z or HMDB data for mass comparison" };
  }

  // Component 4: formula_match (0.20)
  if (claimedFormula && hmdbXml) {
    const dbFormula = xmlTagValue(hmdbXml, "chemical_formula");
    if (dbFormula) {
      const match = normalise(dbFormula) === normalise(claimedFormula);
      componentScores.formula_match = match ? 1.0 : 0.0;
      details.formula = { claimed: claimedFormula, database: dbFormula, match };
    } else {
      componentScores.formula_match = 0.5;
      details.formula = { note: "No formula in HMDB record" };
    }
  } else {
    componentScores.formula_match = 0.5;
    details.formula = { note: "Cannot verify formula" };
  }

  // Component 5: pubchem_cross_ref (0.15)
  if (inchikey) {
    const res = await fetchJson<Record<string, unknown>>(
      `${PUBCHEM_API}/inchikey/${encodeURIComponent(inchikey)}/property/MolecularFormula,MolecularWeight/JSON`,
    );
    if (res.ok && res.data) {
      componentScores.pubchem_cross_ref = 1.0;
      details.pubchem = { found: true, data: res.data };
    } else {
      componentScores.pubchem_cross_ref = 0.0;
      details.pubchem = { found: false };
    }
  } else if (hmdbXml) {
    // Try to get InChIKey from HMDB XML
    const xmlKey = xmlTagValue(hmdbXml, "inchikey");
    if (xmlKey) {
      const res = await fetchJson<Record<string, unknown>>(
        `${PUBCHEM_API}/inchikey/${encodeURIComponent(xmlKey)}/property/MolecularFormula,MolecularWeight/JSON`,
      );
      componentScores.pubchem_cross_ref = res.ok ? 1.0 : 0.3;
      details.pubchem = { found: res.ok, inchikey_from_hmdb: xmlKey };
    } else {
      componentScores.pubchem_cross_ref = 0.5;
      details.pubchem = { note: "No InChIKey available for PubChem cross-reference" };
    }
  } else {
    componentScores.pubchem_cross_ref = 0.5;
    details.pubchem = { note: "No InChIKey for cross-reference" };
  }

  const weights: Record<string, number> = {
    identifier_valid: 0.20,
    name_match: 0.20,
    mass_match: 0.25,
    formula_match: 0.20,
    pubchem_cross_ref: 0.15,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Pathway Mapping ──────────────────────────────────────────────────────

async function verifyPathwayMapping(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const compoundId = str(taskResult.compound_id || taskResult.kegg_compound);
  const pathwayId = str(taskResult.pathway_id || taskResult.kegg_pathway);
  const claimedEnzymes = taskResult.enzymes;

  // Component 1: compound_exists (0.20)
  if (compoundId) {
    const res = await fetchText(`${KEGG_API}/get/${encodeURIComponent(compoundId)}`);
    componentScores.compound_exists = res.ok ? 1.0 : 0.0;
    details.compound = { id: compoundId, found: res.ok };
    if (!res.ok) errors.push(`KEGG compound ${compoundId} not found`);
  } else {
    componentScores.compound_exists = 0.5;
    details.compound = { note: "No compound ID provided" };
  }

  // Component 2: pathway_exists (0.25)
  if (pathwayId) {
    const res = await fetchText(`${KEGG_API}/get/${encodeURIComponent(pathwayId)}`);
    componentScores.pathway_exists = res.ok ? 1.0 : 0.0;
    details.pathway = { id: pathwayId, found: res.ok };
    if (!res.ok) errors.push(`KEGG pathway ${pathwayId} not found`);
  } else {
    componentScores.pathway_exists = 0.5;
    details.pathway = { note: "No pathway ID provided" };
  }

  // Component 3: compound_in_pathway (0.30)
  if (compoundId && pathwayId) {
    const res = await fetchText(`${KEGG_API}/link/compound/${encodeURIComponent(pathwayId)}`);
    if (res.ok && res.text) {
      const lines = res.text.trim().split("\n");
      const compounds = lines.map((l) => {
        const parts = l.split("\t");
        return parts.length >= 2 ? parts[1].trim() : "";
      }).filter(Boolean);

      // Normalize compound IDs for comparison (cpd:C00001 -> C00001)
      const normCompound = compoundId.replace(/^cpd:/, "");
      const found = compounds.some((c) => c.replace(/^cpd:/, "") === normCompound);

      componentScores.compound_in_pathway = found ? 1.0 : 0.0;
      details.compound_in_pathway = { found, compounds_in_pathway: compounds.length };
      if (!found) warnings.push(`${compoundId} not found in pathway ${pathwayId}`);
    } else {
      componentScores.compound_in_pathway = 0.5;
      details.compound_in_pathway = { note: "Could not fetch compound-pathway links" };
    }
  } else {
    componentScores.compound_in_pathway = 0.5;
    details.compound_in_pathway = { note: "Need both compound and pathway IDs" };
  }

  // Component 4: enzyme_links (0.25)
  if (compoundId && claimedEnzymes) {
    const enzymeList = Array.isArray(claimedEnzymes) ? claimedEnzymes.map(String) : [String(claimedEnzymes)];
    const res = await fetchText(`${KEGG_API}/link/enzyme/${encodeURIComponent(compoundId)}`);

    if (res.ok && res.text) {
      const lines = res.text.trim().split("\n");
      const dbEnzymes = lines.map((l) => {
        const parts = l.split("\t");
        return parts.length >= 2 ? parts[1].trim().replace(/^ec:/, "") : "";
      }).filter(Boolean);

      const matched = enzymeList.filter((e) =>
        dbEnzymes.some((de) => de === e.replace(/^ec:/, "")),
      );
      componentScores.enzyme_links = enzymeList.length > 0 ? round4(matched.length / enzymeList.length) : 0.5;
      details.enzymes = { claimed: enzymeList, database: dbEnzymes, matched: matched.length };
    } else {
      componentScores.enzyme_links = 0.5;
      details.enzymes = { note: "Could not fetch enzyme links from KEGG" };
    }
  } else {
    componentScores.enzyme_links = 0.5;
    details.enzymes = { note: "No enzyme data to verify" };
  }

  const weights: Record<string, number> = {
    compound_exists: 0.20,
    pathway_exists: 0.25,
    compound_in_pathway: 0.30,
    enzyme_links: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Spectral Match ───────────────────────────────────────────────────────

async function verifySpectralMatch(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const precursorMz = num(taskResult.precursor_mz ?? taskResult.mz, NaN);
  const adduct = str(taskResult.adduct);
  const peaks = taskResult.peaks || taskResult.fragments || taskResult.peak_list;
  const ppmTolerance = num(taskResult.ppm_tolerance ?? taskResult.mass_accuracy, NaN);

  // Component 1: precursor_valid (0.15)
  if (Number.isFinite(precursorMz)) {
    if (precursorMz >= 50 && precursorMz <= 2000) {
      componentScores.precursor_valid = 1.0;
    } else if (precursorMz >= 20 && precursorMz <= 5000) {
      componentScores.precursor_valid = 0.5;
      warnings.push(`Precursor m/z ${precursorMz} outside typical 50-2000 range`);
    } else {
      componentScores.precursor_valid = 0.0;
      errors.push(`Precursor m/z ${precursorMz} implausible`);
    }
    details.precursor = { mz: precursorMz, score: componentScores.precursor_valid };
  } else {
    componentScores.precursor_valid = 0.5;
    details.precursor = { note: "No precursor m/z provided" };
  }

  // Component 2: adduct_valid (0.10)
  if (adduct) {
    componentScores.adduct_valid = KNOWN_ADDUCTS.has(adduct) ? 1.0 : 0.3;
    details.adduct = { value: adduct, known: KNOWN_ADDUCTS.has(adduct) };
  } else {
    componentScores.adduct_valid = 0.5;
    details.adduct = { note: "No adduct specified" };
  }

  // Component 3: fragment_match (0.35)
  if (Array.isArray(peaks) && peaks.length > 0) {
    let validPeaks = 0;
    let sortedCorrectly = true;
    let prevMz = -Infinity;

    for (const peak of peaks) {
      if (Array.isArray(peak) && peak.length >= 2) {
        const mz = num(peak[0], NaN);
        const intensity = num(peak[1], NaN);
        if (Number.isFinite(mz) && mz > 0 && Number.isFinite(intensity) && intensity >= 0) {
          validPeaks++;
          if (mz < prevMz) sortedCorrectly = false;
          prevMz = mz;
        }
      }
    }

    const validRatio = validPeaks / peaks.length;
    let peakScore = validRatio;
    if (!sortedCorrectly) {
      peakScore *= 0.8;
      warnings.push("Peak list not sorted by m/z");
    }
    componentScores.fragment_match = round4(peakScore);
    details.fragments = { total: peaks.length, valid: validPeaks, sorted: sortedCorrectly };
  } else {
    componentScores.fragment_match = 0.5;
    details.fragments = { note: "No peak list provided" };
  }

  // Component 4: library_hit (0.25)
  if (Number.isFinite(precursorMz)) {
    const mbRes = await fetchJson<Array<Record<string, unknown>>>(
      `${MASSBANK_API}/searchspectrum?mz=${precursorMz}&tol=0.5&unit=Da&limit=5`,
    );
    if (mbRes.ok && Array.isArray(mbRes.data) && mbRes.data.length > 0) {
      componentScores.library_hit = 1.0;
      details.library = { source: "MassBank", hits: mbRes.data.length };
    } else if (mbRes.ok) {
      componentScores.library_hit = 0.3;
      details.library = { source: "MassBank", hits: 0 };
    } else {
      componentScores.library_hit = 0.5;
      details.library = { note: "MassBank query failed", error: mbRes.error };
      warnings.push("Could not query MassBank spectral library");
    }
  } else {
    componentScores.library_hit = 0.5;
    details.library = { note: "No precursor m/z for library search" };
  }

  // Component 5: mass_accuracy (0.15)
  if (Number.isFinite(ppmTolerance)) {
    if (ppmTolerance >= 1 && ppmTolerance <= 20) {
      componentScores.mass_accuracy = 1.0;
    } else if (ppmTolerance >= 0.1 && ppmTolerance <= 50) {
      componentScores.mass_accuracy = 0.7;
    } else {
      componentScores.mass_accuracy = 0.3;
      warnings.push(`Unusual mass accuracy tolerance: ${ppmTolerance} ppm`);
    }
    details.mass_accuracy = { ppm: ppmTolerance, score: componentScores.mass_accuracy };
  } else {
    componentScores.mass_accuracy = 0.5;
    details.mass_accuracy = { note: "No ppm tolerance specified" };
  }

  const weights: Record<string, number> = {
    precursor_valid: 0.15,
    adduct_valid: 0.10,
    fragment_match: 0.35,
    library_hit: 0.25,
    mass_accuracy: 0.15,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Adapter Export ────────────────────────────────────────────────────────

export const metabolomicsAdapter: DomainAdapter = {
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
        case "compound_identification":
          result = await verifyCompoundIdentification(taskResult);
          break;
        case "pathway_mapping":
          result = await verifyPathwayMapping(taskResult);
          break;
        case "spectral_match":
          result = await verifySpectralMatch(taskResult);
          break;
        default:
          return failResult(DOMAIN, [
            `Unsupported metabolomics claim type: '${claimType}'. Valid types: ${VALID_CLAIM_TYPES.join(", ")}`,
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
      return failResult(DOMAIN, [`Metabolomics verification failed: ${message}`]);
    }
  },
};
