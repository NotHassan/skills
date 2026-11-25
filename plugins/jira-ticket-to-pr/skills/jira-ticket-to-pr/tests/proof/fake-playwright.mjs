// A browser-free stand-in for Playwright's chromium API, just deep enough for record().
// Artifacts are written as empty files so the recorder's bookkeeping runs for real.
import fs from 'node:fs';
import path from 'node:path';

const touch = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); };
export const chromium = {
  executablePath: () => '/nonexistent/fake-chromium',
  async launch() {
    return {
      async newContext() {
        return {
          tracing: { async start() {}, async stop({ path: file }) { touch(file); } },
          async newPage() {
            return {
              video: () => ({ async saveAs(file) { touch(file); } }),
              setDefaultTimeout() {}, on() {},
              async screenshot({ path: file }) { touch(file); },
              async waitForTimeout() {},
              isClosed: () => false
            };
          },
          async close() {}
        };
      },
      async close() {}
    };
  }
};
