/**
 * Evaluation on recordings with hand-labelled repetitions (`npm run evaluate`).
 * Recordings live in fixtures/ (not committed: third-party videos). Missing files are skipped.
 * The report separates the 'tune' and 'test' splits; accuracy may only be reported on 'test'.
 */
import * as fs from 'fs';
import * as path from 'path';
import { evaluateRecording, formatReport, matchEvents, toPoses, type Manifest, type RecordingReport } from '../src/evaluation/evaluate';

const ROOT = path.join(__dirname, '..');
const manifestPath = process.env.EVAL_MANIFEST ?? path.join(ROOT, 'scripts', 'evaluate', 'manifest.json');
const fixturesDir = process.env.EVAL_FIXTURES ?? path.join(ROOT, 'fixtures');

describe('evaluation tooling', () => {
  test('event matching counts misses and false positives', () => {
    expect(matchEvents([1000, 2000, 3000], [1100, 2900, 5000], 300)).toEqual({ matched: 2, missed: 1, falsePositives: 1 });
  });
});

describe('labelled recordings', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  const available = manifest.recordings.filter((r) => fs.existsSync(path.join(fixturesDir, r.file)));
  const maybe = available.length ? test : test.skip;
  maybe(`report (${available.length}/${manifest.recordings.length} recordings available)`, () => {
    const reports: RecordingReport[] = available.map((rec) => {
      const data = JSON.parse(fs.readFileSync(path.join(fixturesDir, rec.file), 'utf8'));
      return evaluateRecording(rec, toPoses(rec.format, data), manifest.toleranceMs);
    });
    // eslint-disable-next-line no-console
    console.log(formatReport(reports));
    // Regression guard for the known recordings (all in the 'test' split).
    for (const r of reports) {
      expect(r.missed).toBe(0);
      expect(r.falsePositives).toBe(0);
    }
  });
});
