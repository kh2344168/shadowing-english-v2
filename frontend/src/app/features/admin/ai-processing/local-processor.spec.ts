import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { archive, readArchive } from './local-archive';
import { importLesson, LocalDraftTransfer, LocalLesson, validateManifest } from './local-lesson';
import { DEFAULT_PROCESSOR_SETTINGS, LocalProcessorClient } from './local-processor.client';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const encoder = new TextEncoder();
function wav(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32044);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const)
    bytes.set(encoder.encode(text), offset);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, bytes.length - 44, true);
  return bytes;
}
async function lesson(): Promise<{ manifest: LocalLesson; bytes: Uint8Array<ArrayBuffer> }> {
  const bytes = wav();
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return {
    bytes,
    manifest: {
      schemaVersion: 1,
      profile: 'shadowing-v2-1',
      jobId: JOB_ID,
      title: 'First lesson',
      description: '',
      duration: 1,
      reviewRequired: true,
      segments: [
        {
          text: 'Hello.',
          start: 0,
          end: 1,
          audioFile: 'segment-01.wav',
          bytes: bytes.length,
          sha256: Array.from(new Uint8Array(hash), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join(''),
        },
      ],
    },
  };
}
function connection(userId = 'admin-1', origin = location.origin) {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    userId,
    origin,
    token: 'a'.repeat(64),
    settings: DEFAULT_PROCESSOR_SETTINGS,
  };
}

describe('Local processor contracts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('File', NodeFile);
    vi.stubGlobal('crypto', webcrypto);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('imports a verified WAV package without a backend request', async () => {
    const { manifest, bytes } = await lesson();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const zip = archive([
      { name: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest)) },
      { name: 'segment-01.wav', bytes },
    ]);
    const result = await importLesson(new File([zip], 'lesson.zip'));
    expect(result.manifest.title).toBe('First lesson');
    expect(result.files[0].size).toBe(32044);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects corruption, directory traversal and extra archive content', async () => {
    const { manifest, bytes } = await lesson();
    const entries = [
      { name: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest)) },
      { name: 'segment-01.wav', bytes },
    ];
    const buffer = await archive(entries).arrayBuffer();
    const modified = new Uint8Array(buffer);
    modified[80] ^= 1;
    expect(() => readArchive(buffer)).toThrow();
    const traversal = archive([{ ...entries[0], name: '../manifest.json' }, entries[1]]);
    expect(() => readArchive(new ArrayBuffer(0))).toThrow();
    await expect(importLesson(new File([traversal], 'lesson.zip'))).rejects.toThrow();
    await expect(
      importLesson(
        new File([archive([...entries, { name: 'segment-02.wav', bytes }])], 'lesson.zip'),
      ),
    ).rejects.toThrow();
  });

  it('rejects a changed WAV even when the ZIP CRC is valid', async () => {
    const { manifest, bytes } = await lesson();
    bytes[100] = 42;
    const zip = archive([
      { name: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest)) },
      { name: 'segment-01.wav', bytes },
    ]);
    await expect(importLesson(new File([zip], 'lesson.zip'))).rejects.toThrow();
  });

  it('rejects unsupported output, invalid timings and too many clips', async () => {
    const { manifest } = await lesson();
    expect(() => validateManifest({ ...manifest, schemaVersion: 2 })).toThrow();
    expect(() => validateManifest({ ...manifest, reviewRequired: false })).toThrow();
    expect(() => validateManifest({ ...manifest, jobId: '-'.repeat(36) })).toThrow();
    expect(() =>
      validateManifest({ ...manifest, segments: [{ ...manifest.segments[0], start: 1, end: 0 }] }),
    ).toThrow();
    expect(() =>
      validateManifest({ ...manifest, segments: Array(21).fill(manifest.segments[0]) }),
    ).toThrow();
  });

  it('isolates in-memory drafts and pairing keys between accounts', async () => {
    const { manifest, bytes } = await lesson();
    const transfer = new LocalDraftTransfer();
    transfer.set('admin-1', { manifest, files: [new File([bytes], 'segment-01.wav')] });
    expect(transfer.take('admin-2')).toBeNull();
    expect(transfer.take('admin-1')).toBeNull();
    localStorage.setItem('shadowing.local-processor.admin-1', JSON.stringify(connection()));
    const client = new LocalProcessorClient();
    expect(client.initialize('admin-1')).toBeTruthy();
    expect(client.initialize('admin-2')).toBeNull();
    await expect(
      client.importLink(new File([JSON.stringify(connection())], 'shadowing-link.json')),
    ).rejects.toThrow();
    client.initialize('admin-1');
    await expect(
      client.importLink(
        new File(
          [JSON.stringify(connection('admin-1', 'https://another.test'))],
          'shadowing-link.json',
        ),
      ),
    ).rejects.toThrow();
  });

  it('uses only the local pairing token and omits website credentials', async () => {
    localStorage.setItem('shadowing.local-processor.admin-1', JSON.stringify(connection()));
    const client = new LocalProcessorClient();
    client.initialize('admin-1');
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ protocolVersion: 1, linked: true })));
    vi.stubGlobal('fetch', fetch);
    expect((await client.health()).linked).toBe(true);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:43127/v1/health');
    expect(options.credentials).toBe('omit');
    expect(options.headers).toEqual({ Authorization: 'Bearer ' + 'a'.repeat(64) });
    expect(options.redirect).toBe('error');
  });

  it('validates the job before uploading the source and sends settings on explicit processing', async () => {
    localStorage.setItem('shadowing.local-processor.admin-1', JSON.stringify(connection()));
    const client = new LocalProcessorClient();
    client.initialize('admin-1');
    const fetch = vi
      .fn()
      .mockImplementation(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith('/settings')
                ? DEFAULT_PROCESSOR_SETTINGS
                : url.endsWith('/source')
                  ? { jobId: JOB_ID, state: 'running' }
                  : { jobId: JOB_ID, state: 'awaiting_upload' },
            ),
          ),
      );
    vi.stubGlobal('fetch', fetch);
    const received = vi.fn();
    await client.start(
      {
        requestId: JOB_ID,
        title: 'First lesson',
        description: '',
        lines: ['Hello.'],
        settings: DEFAULT_PROCESSOR_SETTINGS,
      },
      new File([wav()], 'teacher.wav'),
      new AbortController().signal,
      received,
    );
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:43127/v1/settings',
      'http://127.0.0.1:43127/v1/jobs',
      `http://127.0.0.1:43127/v1/jobs/${JOB_ID}/source`,
    ]);
    expect(received).toHaveBeenCalledWith({ jobId: JOB_ID, state: 'awaiting_upload' });
    expect(client.savedJob()).toBe(JOB_ID);
    expect(fetch.mock.calls.every(([, options]) => options.credentials === 'omit')).toBe(true);
    fetch.mockImplementation(
      async () => new Response(JSON.stringify({ jobId: '../../file', state: 'running' })),
    );
    await expect(client.job(JOB_ID)).rejects.toThrow('invalid_job');
  });
});
