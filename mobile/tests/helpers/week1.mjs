// Builds a small, valid lesson pack (the same shape the server publishes).
import { zipSync, strToU8 } from 'fflate';

export const manifest = {
  manifest_version: 1,
  language: 'en',
  modules: [
    {
      key: 'm1', title: 'The alphabet', order: 1, duration_min: 10, content_type: 'text', body_file: 'm1/lesson.md',
      quiz: {
        pass_mark: 70,
        questions: [
          { key: 'q1', type: 'single_choice', prompt: 'Which letter comes first?', options: ['A', 'B', 'C'], correct_index: 0, explanation: 'A is the first letter.' },
          { key: 'q2', type: 'single_choice', prompt: 'Which letter comes after B?', options: ['A', 'C', 'D'], correct_index: 1 },
        ],
      },
    },
    { key: 'm2', title: 'Reading short words', order: 2, duration_min: 15, content_type: 'text', body_file: 'm2/lesson.md' },
  ],
};

export function makeWeek1Zip() {
  return Buffer.from(zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'm1/lesson.md': strToU8('# The alphabet\n\nA, B, C are letters.\n'),
    'm2/lesson.md': strToU8('# Short words\n\nCat, dog, sun.\n'),
  }));
}
