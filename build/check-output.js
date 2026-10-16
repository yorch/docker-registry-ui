import fs from 'node:fs';
import path from 'node:path';

const files = [
  'docker-registry-ui.css',
  'docker-registry-ui.js',
  'fonts/IBMPlexSans.ttf',
  'fonts/IBMPlexMono-Regular.ttf',
  'fonts/IBMPlexMono-Medium.ttf',
  'fonts/IBMPlexMono-SemiBold.ttf',
  'fonts/IBMPlexMono-Bold.ttf',
  'images/docker-logo.svg',
  'index.html',
];

// Checks the directory the build actually wrote to, so `--outDir` is honoured.
export default function () {
  let output;
  return {
    name: 'check-output',
    configResolved: (config) => {
      output = path.resolve(config.root, config.build.outDir);
    },
    writeBundle: () => {
      const missingFile = files.find((file) => !fs.existsSync(path.join(output, file)));
      if (missingFile) {
        throw new Error(`File ${missingFile} is missing after build`);
      }
    },
  };
}
