import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertPdfSurface,
  createPdfSurfaceFixture,
  startPdfFixtureHost
} from '../../scripts/desktop/pdf-surface-fixture.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');

test('Electron desktop host exposes PDF original and annotations without leaking paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flowmind-desktop-pdf-test-'));
  let host;
  try {
    const fixture = await createPdfSurfaceFixture(root);
    assert.equal(fs.existsSync(fixture.databasePath), true);
    host = await startPdfFixtureHost({ projectRoot, root, fixture });
    await assertPdfSurface(host.origin, fixture);
  } finally {
    await host?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
