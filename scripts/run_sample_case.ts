import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { runEvaluationClaim } from '../eval/claim_decider.js';
import type { EvaluationCase } from '../eval/types.js';
import { NightshiftSampleAdapter } from '../app/adapters/nightshiftSample.js';

// Runs cached case evidence through the full SQL, probe, memory and policy loop.
export async function runSampleCase(inputFile: string) {
  const input = z
    .object({ case_file: z.string().min(1) })
    .parse(JSON.parse(await readFile(inputFile, 'utf8')));
  const evidence = JSON.parse(await readFile(input.case_file, 'utf8')) as EvaluationCase;
  if (!evidence.policy?.synthetic || !evidence.station || !evidence.satellite) {
    throw new Error(
      'A sample case requires synthetic policy terms and both cached rainfall sources.'
    );
  }
  return runEvaluationClaim(evidence, new NightshiftSampleAdapter());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input) {
    console.error('Use tsx scripts/run_sample_case.ts <input.json>.');
    process.exitCode = 1;
  } else {
    runSampleCase(input)
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch(() => {
        console.error(
          'The cached sample case could not complete. Check the input and evidence files.'
        );
        process.exitCode = 1;
      });
  }
}
