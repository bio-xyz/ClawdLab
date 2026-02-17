/**
 * Bioinformatics Domain Adapter
 *
 * Verifies bioinformatics claims: sequence analysis results, alignment outputs,
 * and pipeline validations using NCBI Entrez, UniProt, and Ensembl APIs.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";
import { fetchJson } from "../utils/http-client";

const DOMAIN = "bioinformatics";

const NCBI_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const UNIPROT_API = "https://rest.uniprot.org/uniprotkb";
const ENSEMBL_API = "https://rest.ensembl.org";

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

function extractNested(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split(/[,;\s]+/).filter(Boolean);
  return [];
}

/** Known sequence analysis tools. */
const KNOWN_ANALYSIS_TOOLS = new Set([
  "blast", "blastp", "blastn", "blastx", "tblastn", "tblastx",
  "hmmer", "hmmscan", "hmmsearch", "jackhmmer", "phmmer",
  "mafft", "clustalw", "clustalo", "muscle", "t-coffee", "tcoffee",
  "diamond", "cd-hit", "cdhit", "mmseqs", "mmseqs2",
  "interproscan", "pfam", "prosite", "signalp", "tmhmm",
  "phyre2", "i-tasser", "alphafold", "rosettafold",
]);

/** Known alignment tools. */
const KNOWN_ALIGNMENT_TOOLS = new Set([
  "mafft", "clustalw", "clustalo", "muscle", "t-coffee", "tcoffee",
  "blast", "blastp", "blastn", "blastx", "tblastn", "tblastx",
  "diamond", "minimap2", "bowtie2", "bwa", "hisat2", "star",
  "kalign", "prank", "probcons", "dialign",
  "hmmer", "hmmscan", "hmmsearch",
  "needle", "water", "stretcher", "emboss",
]);

/** Known bioinformatics pipeline tools. */
const KNOWN_PIPELINE_TOOLS = new Set([
  "bwa", "bwa-mem2", "bowtie2", "hisat2", "star", "minimap2",
  "samtools", "bcftools", "htslib",
  "gatk", "picard", "freebayes", "deepvariant", "strelka2", "mutect2",
  "fastqc", "multiqc", "fastp", "trim_galore", "trimmomatic", "cutadapt",
  "salmon", "kallisto", "rsem", "htseq", "featurecounts", "stringtie", "cufflinks",
  "deseq2", "edger", "limma", "sleuth",
  "spades", "megahit", "velvet", "abyss", "flye", "canu", "hifiasm",
  "prokka", "bakta", "roary", "snippy",
  "snpeff", "annovar", "vep", "funcotator",
  "bedtools", "deeptools", "macs2", "homer",
  "nextflow", "snakemake", "cwl", "wdl", "cromwell",
]);

/** Known sequence databases. */
const KNOWN_DATABASES = new Set([
  "genbank", "refseq", "nr", "nt", "swissprot", "uniprot", "uniprotkb",
  "trembl", "pdb", "embl", "ddbj", "ensembl", "ncbi",
  "pfam", "interpro", "prosite", "tigrfam", "hamap",
  "kegg", "go", "reactome", "string",
  "silva", "greengenes", "rdp", "unite",
  "arrayexpress", "geo", "sra", "ena",
  "dbsnp", "clinvar", "cosmic", "gnomad", "exac",
  "flybase", "wormbase", "tair", "sgd", "mgi", "rgd", "zfin",
]);

// ── Sequence Analysis ───────────────────────────────────────────────────

async function verifySequenceAnalysis(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const seqId = str(taskResult.sequence_id || taskResult.accession || taskResult.identifier || taskResult.id);

  // Component 1: identifier_valid (0.25) — check if NCBI/UniProt ID exists
  if (seqId) {
    // Try UniProt first (matches P12345, Q9UHC1, etc.)
    const uniprotPattern = /^[A-NR-Z][0-9][A-Z0-9]{3}[0-9]$/i;
    if (uniprotPattern.test(seqId)) {
      const res = await fetchJson<Record<string, unknown>>(
        `${UNIPROT_API}/${encodeURIComponent(seqId)}`,
      );
      if (res.ok && res.data) {
        componentScores.identifier_valid = 1.0;
        details.identifier = { id: seqId, source: "UniProt", found: true };
      } else {
        // Fallback to NCBI protein
        const ncbiRes = await fetchJson<Record<string, unknown>>(
          `${NCBI_ESEARCH}?db=protein&term=${encodeURIComponent(seqId)}&retmode=json`,
        );
        const count = num(extractNested(ncbiRes.data, "esearchresult.count"));
        componentScores.identifier_valid = count > 0 ? 0.8 : 0.0;
        details.identifier = { id: seqId, source: count > 0 ? "ncbi_protein" : "not_found", found: count > 0 };
        if (count === 0) errors.push(`Sequence ID ${seqId} not found in UniProt or NCBI`);
      }
    } else {
      // Try NCBI nucleotide and protein databases
      const [nucRes, protRes] = await Promise.all([
        fetchJson<Record<string, unknown>>(
          `${NCBI_ESEARCH}?db=nucleotide&term=${encodeURIComponent(seqId)}&retmode=json`,
        ),
        fetchJson<Record<string, unknown>>(
          `${NCBI_ESEARCH}?db=protein&term=${encodeURIComponent(seqId)}&retmode=json`,
        ),
      ]);
      const nucCount = num(extractNested(nucRes.data, "esearchresult.count"));
      const protCount = num(extractNested(protRes.data, "esearchresult.count"));
      if (nucCount > 0 || protCount > 0) {
        componentScores.identifier_valid = 1.0;
        details.identifier = {
          id: seqId,
          source: nucCount > 0 ? "ncbi_nucleotide" : "ncbi_protein",
          found: true,
        };
      } else {
        // Final fallback: try Ensembl
        const ensRes = await fetchJson<Record<string, unknown>>(
          `${ENSEMBL_API}/lookup/id/${encodeURIComponent(seqId)}?content-type=application/json`,
        );
        if (ensRes.ok && ensRes.data) {
          componentScores.identifier_valid = 1.0;
          details.identifier = { id: seqId, source: "ensembl", found: true };
        } else {
          componentScores.identifier_valid = 0.0;
          details.identifier = { id: seqId, source: "not_found", found: false };
          errors.push(`Sequence ID ${seqId} not found in NCBI, UniProt, or Ensembl`);
        }
      }
    }
  } else {
    componentScores.identifier_valid = 0.5;
    details.identifier = { note: "No sequence ID provided" };
  }

  // Component 2: format_valid (0.20) — validate FASTA/sequence format
  const sequence = str(taskResult.sequence || taskResult.fasta || taskResult.seq);
  if (sequence) {
    const lines = sequence.trim().split(/\n/);
    const hasFastaHeader = lines[0]?.startsWith(">");
    const seqLines = hasFastaHeader ? lines.slice(1) : lines;
    const rawSeq = seqLines.join("").replace(/\s/g, "");

    const nucleotidePattern = /^[ACGTURYKMSWBDHVNacgturykmswbdhvn]+$/;
    const proteinPattern = /^[ACDEFGHIKLMNPQRSTVWYXacdefghiklmnpqrstvwyx*-]+$/;

    if (rawSeq.length > 0 && (nucleotidePattern.test(rawSeq) || proteinPattern.test(rawSeq))) {
      componentScores.format_valid = 1.0;
      details.format = {
        has_fasta_header: hasFastaHeader,
        sequence_length: rawSeq.length,
        type: nucleotidePattern.test(rawSeq) ? "nucleotide" : "protein",
        valid: true,
      };
    } else if (rawSeq.length === 0) {
      componentScores.format_valid = 0.0;
      details.format = { valid: false, note: "Empty sequence" };
      errors.push("Sequence is empty");
    } else {
      componentScores.format_valid = 0.2;
      details.format = { valid: false, note: "Sequence contains invalid characters" };
      warnings.push("Sequence contains characters not matching nucleotide or protein alphabets");
    }
  } else {
    componentScores.format_valid = 0.5;
    details.format = { note: "No sequence provided" };
  }

  // Component 3: method_valid (0.20) — check known tools
  const method = str(taskResult.method || taskResult.tool || taskResult.algorithm);
  if (method) {
    const normMethod = method.toLowerCase().replace(/[\s_-]+/g, "");
    const found = [...KNOWN_ANALYSIS_TOOLS].some(
      (t) => normMethod.includes(t.replace(/[\s_-]+/g, "")),
    );
    componentScores.method_valid = found ? 1.0 : 0.2;
    details.method = { claimed: method, recognized: found };
    if (!found) warnings.push(`Analysis tool "${method}" not in known tools list`);
  } else {
    componentScores.method_valid = 0.5;
    details.method = { note: "No analysis method provided" };
  }

  // Component 4: statistics_valid (0.20) — e-value/identity/coverage plausibility
  const eValue = taskResult.e_value ?? taskResult.evalue;
  const identity = taskResult.identity ?? taskResult.percent_identity;
  const coverage = taskResult.coverage ?? taskResult.query_coverage;
  let statChecks = 0;
  let statPassed = 0;

  if (eValue != null) {
    statChecks++;
    const e = num(eValue, -1);
    if (e >= 0) {
      statPassed++;
      details.e_value = { value: e, valid: true };
    } else {
      details.e_value = { value: eValue, valid: false };
      errors.push(`E-value ${eValue} is negative`);
    }
  }

  if (identity != null) {
    statChecks++;
    const id = num(identity, -1);
    if (id >= 0 && id <= 100) {
      statPassed++;
      details.identity = { value: id, valid: true };
    } else {
      details.identity = { value: identity, valid: false };
      errors.push(`Identity ${identity} out of [0, 100] range`);
    }
  }

  if (coverage != null) {
    statChecks++;
    const cov = num(coverage, -1);
    if (cov >= 0 && cov <= 100) {
      statPassed++;
      details.coverage = { value: cov, valid: true };
    } else {
      details.coverage = { value: coverage, valid: false };
      errors.push(`Coverage ${coverage} out of [0, 100] range`);
    }
  }

  if (statChecks > 0) {
    componentScores.statistics_valid = round4(statPassed / statChecks);
    details.statistics = { checks: statChecks, passed: statPassed };
  } else {
    componentScores.statistics_valid = 0.5;
    details.statistics = { note: "No statistics provided (e-value, identity, coverage)" };
  }

  // Component 5: database_valid (0.15) — check database name is known
  const database = str(taskResult.database || taskResult.db);
  if (database) {
    const normDb = database.toLowerCase().replace(/[\s_-]+/g, "");
    const found = [...KNOWN_DATABASES].some(
      (d) => normDb.includes(d.replace(/[\s_-]+/g, "")),
    );
    componentScores.database_valid = found ? 1.0 : 0.2;
    details.database = { claimed: database, recognized: found };
    if (!found) warnings.push(`Database "${database}" not in known databases list`);
  } else {
    componentScores.database_valid = 0.5;
    details.database = { note: "No database specified" };
  }

  const weights: Record<string, number> = {
    identifier_valid: 0.25,
    format_valid: 0.20,
    method_valid: 0.20,
    statistics_valid: 0.20,
    database_valid: 0.15,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Alignment ───────────────────────────────────────────────────────────

async function verifyAlignment(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  // Component 1: sequences_valid (0.25) — validate input sequences
  const sequences = taskResult.sequences || taskResult.input_sequences;
  if (Array.isArray(sequences) && sequences.length > 0) {
    const nucleotidePattern = /^[ACGTURYKMSWBDHVNacgturykmswbdhvn\-.*]+$/;
    const proteinPattern = /^[ACDEFGHIKLMNPQRSTVWYXacdefghiklmnpqrstvwyx*\-. ]+$/;

    let validCount = 0;
    const sampleSize = Math.min(sequences.length, 20);
    for (let i = 0; i < sampleSize; i++) {
      const seq = str(sequences[i]);
      const rawSeq = seq.startsWith(">")
        ? seq.split(/\n/).slice(1).join("").replace(/\s/g, "")
        : seq.replace(/\s/g, "");
      if (rawSeq.length > 0 && (nucleotidePattern.test(rawSeq) || proteinPattern.test(rawSeq))) {
        validCount++;
      }
    }
    componentScores.sequences_valid = round4(validCount / sampleSize);
    details.sequences = { total: sequences.length, sampled: sampleSize, valid: validCount };
    if (validCount < sampleSize) {
      warnings.push(`${sampleSize - validCount} of ${sampleSize} sampled sequences have invalid characters`);
    }
  } else if (typeof sequences === "string" && sequences.trim().length > 0) {
    // Single multi-FASTA string
    const entries = sequences.split(/>/).filter(Boolean);
    componentScores.sequences_valid = entries.length > 0 ? 0.8 : 0.2;
    details.sequences = { format: "multi_fasta_string", entries: entries.length };
  } else {
    // Check for individual query/subject sequence fields
    const querySeq = str(taskResult.query || taskResult.query_sequence);
    const subjectSeq = str(taskResult.subject || taskResult.subject_sequence || taskResult.target);
    if (querySeq || subjectSeq) {
      let validPairs = 0;
      if (querySeq.length > 0) validPairs++;
      if (subjectSeq.length > 0) validPairs++;
      componentScores.sequences_valid = round4(validPairs / 2);
      details.sequences = { query_provided: !!querySeq, subject_provided: !!subjectSeq };
    } else {
      componentScores.sequences_valid = 0.5;
      details.sequences = { note: "No input sequences provided" };
    }
  }

  // Component 2: method_valid (0.20) — check known alignment tools
  const method = str(taskResult.method || taskResult.tool || taskResult.algorithm);
  if (method) {
    const normMethod = method.toLowerCase().replace(/[\s_-]+/g, "");
    const found = [...KNOWN_ALIGNMENT_TOOLS].some(
      (t) => normMethod.includes(t.replace(/[\s_-]+/g, "")),
    );
    componentScores.method_valid = found ? 1.0 : 0.2;
    details.method = { claimed: method, recognized: found };
    if (!found) warnings.push(`Alignment tool "${method}" not in known tools list`);
  } else {
    componentScores.method_valid = 0.5;
    details.method = { note: "No alignment method provided" };
  }

  // Component 3: identity_plausible (0.25) — sequence identity in [0, 100]
  const identity = taskResult.identity ?? taskResult.percent_identity ?? taskResult.sequence_identity;
  if (identity != null) {
    const id = num(identity, -1);
    if (id >= 0 && id <= 100) {
      componentScores.identity_plausible = 1.0;
      details.identity = { value: id, valid: true };
    } else {
      componentScores.identity_plausible = 0.0;
      details.identity = { value: identity, valid: false };
      errors.push(`Sequence identity ${identity} out of [0, 100] range`);
    }
  } else {
    componentScores.identity_plausible = 0.5;
    details.identity = { note: "No sequence identity provided" };
  }

  // Component 4: gap_analysis (0.15) — gap percentage plausible
  const gapPercentage = taskResult.gap_percentage ?? taskResult.gaps ?? taskResult.gap_fraction;
  if (gapPercentage != null) {
    const gap = num(gapPercentage, -1);
    if (gap >= 0 && gap <= 100) {
      if (gap <= 50) {
        componentScores.gap_analysis = 1.0;
      } else if (gap <= 80) {
        componentScores.gap_analysis = 0.5;
        warnings.push(`Gap percentage ${gap}% is high, alignment may be poor`);
      } else {
        componentScores.gap_analysis = 0.2;
        warnings.push(`Gap percentage ${gap}% is very high, alignment is likely unreliable`);
      }
      details.gap_analysis = { gap_percentage: gap, score: componentScores.gap_analysis };
    } else {
      componentScores.gap_analysis = 0.0;
      details.gap_analysis = { value: gapPercentage, valid: false };
      errors.push(`Gap percentage ${gapPercentage} out of [0, 100] range`);
    }
  } else {
    componentScores.gap_analysis = 0.5;
    details.gap_analysis = { note: "No gap percentage provided" };
  }

  // Component 5: score_valid (0.15) — alignment score > 0
  const alignmentScore = taskResult.score ?? taskResult.alignment_score ?? taskResult.bit_score;
  if (alignmentScore != null) {
    const sc = num(alignmentScore, -1);
    if (sc > 0) {
      componentScores.score_valid = 1.0;
      details.score = { value: sc, valid: true };
    } else if (sc === 0) {
      componentScores.score_valid = 0.3;
      details.score = { value: sc, valid: false, note: "Zero alignment score is suspicious" };
      warnings.push("Alignment score is zero");
    } else {
      componentScores.score_valid = 0.0;
      details.score = { value: alignmentScore, valid: false };
      errors.push(`Alignment score ${alignmentScore} is negative`);
    }
  } else {
    componentScores.score_valid = 0.5;
    details.score = { note: "No alignment score provided" };
  }

  const weights: Record<string, number> = {
    sequences_valid: 0.25,
    method_valid: 0.20,
    identity_plausible: 0.25,
    gap_analysis: 0.15,
    score_valid: 0.15,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Pipeline Validation ─────────────────────────────────────────────────

async function verifyPipelineValidation(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  // Component 1: tools_valid (0.30) — check known bioinformatics tools
  const tools = asStringArray(taskResult.tools || taskResult.software || taskResult.pipeline_tools);
  if (tools.length > 0) {
    let recognized = 0;
    const toolResults: Array<{ tool: string; recognized: boolean }> = [];
    for (const tool of tools) {
      const normTool = tool.toLowerCase().replace(/[\s_-]+/g, "");
      const found = [...KNOWN_PIPELINE_TOOLS].some(
        (t) => normTool.includes(t.replace(/[\s_-]+/g, "")),
      );
      if (found) recognized++;
      toolResults.push({ tool, recognized: found });
    }
    componentScores.tools_valid = round4(recognized / tools.length);
    details.tools = { total: tools.length, recognized, results: toolResults };

    if (recognized === 0) {
      errors.push("None of the listed tools are recognized bioinformatics software");
    } else if (recognized < tools.length) {
      const unrecognized = tools.length - recognized;
      warnings.push(`${unrecognized} of ${tools.length} tools not in known tools list`);
    }
  } else {
    componentScores.tools_valid = 0.0;
    details.tools = { note: "No tools listed in pipeline" };
    errors.push("Pipeline must specify at least one tool");
  }

  // Component 2: steps_coherent (0.25) — pipeline has >1 step
  const steps = taskResult.steps || taskResult.pipeline_steps || taskResult.workflow;
  if (Array.isArray(steps)) {
    if (steps.length > 1) {
      componentScores.steps_coherent = 1.0;
      details.steps = { count: steps.length, coherent: true };

      // Check for ordering issues: QC should come before analysis
      const stepDescriptions = steps.map((s) => {
        if (typeof s === "string") return s;
        if (typeof s === "object" && s !== null) {
          const step = s as Record<string, unknown>;
          return str(step.name || step.description || step.tool || "");
        }
        return "";
      });

      const qcKeywords = ["fastqc", "multiqc", "quality", "trim", "fastp", "cutadapt"];
      const analysisKeywords = ["variant", "call", "deseq", "edger", "assembly", "annotation"];
      const firstQcIdx = stepDescriptions.findIndex((d) =>
        qcKeywords.some((k) => d.toLowerCase().includes(k)),
      );
      const firstAnalysisIdx = stepDescriptions.findIndex((d) =>
        analysisKeywords.some((k) => d.toLowerCase().includes(k)),
      );

      if (firstQcIdx >= 0 && firstAnalysisIdx >= 0 && firstQcIdx > firstAnalysisIdx) {
        componentScores.steps_coherent = 0.6;
        warnings.push("QC steps appear after analysis steps, unusual pipeline ordering");
        details.steps = { count: steps.length, coherent: false, note: "QC after analysis" };
      }
    } else if (steps.length === 1) {
      componentScores.steps_coherent = 0.3;
      details.steps = { count: 1, coherent: false, note: "Pipeline has only one step" };
      warnings.push("Pipeline has only a single step; expected multiple steps");
    } else {
      componentScores.steps_coherent = 0.0;
      details.steps = { count: 0, coherent: false };
      errors.push("Pipeline steps array is empty");
    }
  } else if (typeof steps === "string" && steps.trim().length > 0) {
    const stepLines = steps.split(/[;\n|]+/).filter((s: string) => s.trim().length > 0);
    if (stepLines.length > 1) {
      componentScores.steps_coherent = 0.8;
      details.steps = { count: stepLines.length, format: "text_description", coherent: true };
    } else {
      componentScores.steps_coherent = 0.4;
      details.steps = { count: stepLines.length, format: "text_description", coherent: false };
      warnings.push("Pipeline description does not clearly delineate multiple steps");
    }
  } else {
    componentScores.steps_coherent = 0.5;
    details.steps = { note: "No pipeline steps provided" };
  }

  // Component 3: input_valid (0.20) — has input data description
  const inputData = taskResult.input || taskResult.input_data || taskResult.input_files || taskResult.input_description;
  if (inputData) {
    const inputStr = typeof inputData === "string" ? inputData : JSON.stringify(inputData);
    if (inputStr.length > 0) {
      const knownFormats = [
        "fastq", "fasta", "bam", "sam", "vcf", "bed", "gff", "gtf",
        "csv", "tsv", "sra", "fq", "fa", "cram",
      ];
      const mentionsFormat = knownFormats.some((f) => inputStr.toLowerCase().includes(f));

      if (mentionsFormat) {
        componentScores.input_valid = 1.0;
        details.input = { provided: true, mentions_known_format: true };
      } else {
        componentScores.input_valid = 0.7;
        details.input = { provided: true, mentions_known_format: false };
        warnings.push("Input data description does not mention a recognized file format");
      }
    } else {
      componentScores.input_valid = 0.0;
      details.input = { provided: false };
      errors.push("Input data description is empty");
    }
  } else {
    componentScores.input_valid = 0.0;
    details.input = { note: "No input data description provided" };
    errors.push("Pipeline must describe input data");
  }

  // Component 4: output_valid (0.25) — has output data description
  const outputData = taskResult.output || taskResult.output_data || taskResult.output_files || taskResult.output_description;
  if (outputData) {
    const outputStr = typeof outputData === "string" ? outputData : JSON.stringify(outputData);
    if (outputStr.length > 0) {
      const knownOutputs = [
        "vcf", "bam", "sam", "bed", "gff", "gtf", "csv", "tsv", "txt",
        "fasta", "fastq", "html", "pdf", "png", "svg",
        "counts", "matrix", "table", "report", "annotation", "assembly",
        "cram", "bigwig", "bw", "bedgraph",
      ];
      const mentionsFormat = knownOutputs.some((f) => outputStr.toLowerCase().includes(f));

      if (mentionsFormat) {
        componentScores.output_valid = 1.0;
        details.output = { provided: true, mentions_known_format: true };
      } else {
        componentScores.output_valid = 0.7;
        details.output = { provided: true, mentions_known_format: false };
        warnings.push("Output data description does not mention a recognized file format");
      }
    } else {
      componentScores.output_valid = 0.0;
      details.output = { provided: false };
      errors.push("Output data description is empty");
    }
  } else {
    componentScores.output_valid = 0.0;
    details.output = { note: "No output data description provided" };
    errors.push("Pipeline must describe output data");
  }

  const weights: Record<string, number> = {
    tools_valid: 0.30,
    steps_coherent: 0.25,
    input_valid: 0.20,
    output_valid: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Adapter Export ────────────────────────────────────────────────────────

export const bioinformaticsAdapter: DomainAdapter = {
  domain: DOMAIN,

  async verify(taskResult, taskMetadata): Promise<VerificationResult> {
    const start = performance.now();
    const claimType = str(taskResult.claim_type || taskMetadata.claim_type);

    try {
      let result: { score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] };

      switch (claimType) {
        case "sequence_analysis":
          result = await verifySequenceAnalysis(taskResult);
          break;
        case "alignment":
          result = await verifyAlignment(taskResult);
          break;
        case "pipeline_validation":
          result = await verifyPipelineValidation(taskResult);
          break;
        default:
          return failResult(DOMAIN, [`Unsupported bioinformatics claim type: ${claimType}`]);
      }

      const elapsed = (performance.now() - start) / 1000;
      return successResult(DOMAIN, result.score, { claim_type: claimType, ...result.details }, {
        warnings: result.warnings,
        errors: result.errors,
        compute_time_seconds: elapsed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return failResult(DOMAIN, [`Bioinformatics verification failed: ${message}`]);
    }
  },
};
