import type { Config } from './types';

/**
 * Loads HTML via Lightpanda fetch command.
 * Expects Lightpanda to be running in a sibling Docker container.
 */
export async function loadHtml(cfg: Config): Promise<string> {
  const uri = `${cfg.kpUri}/${cfg.votesUri}`;

  const args = [
    'exec', 'lightpanda',
    'lightpanda', 'fetch',
    '--dump', 'html',
    '--http-timeout', '60000',
    '--wait-ms', '15000',
    uri,
  ];

  const out = await run('docker', args);

  // Strip log lines before <!DOCTYPE or <html
  const htmlStart = Math.min(
    out.indexOf('<!DOCTYPE') === -1 ? Infinity : out.indexOf('<!DOCTYPE'),
    out.indexOf('<html') === -1 ? Infinity : out.indexOf('<html'),
  );
  if (htmlStart === Infinity) {
    throw new Error(`No HTML in Lightpanda output: ${out.slice(0, 500)}`);
  }

  return out.slice(htmlStart);
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let stdout = '';
    let stderr = '';

    const decoder = new TextDecoder();
    const read = (stream: ReadableStream<Uint8Array>, buf: { s: string }) =>
      new Promise<void>(async (ok) => {
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf.s += decoder.decode(value, { stream: true });
        }
        buf.s += decoder.decode();
        ok();
      });

    const outBuf = { s: '' };
    const errBuf = { s: '' };

    Promise.all([read(proc.stdout, outBuf), read(proc.stderr, errBuf)])
      .then(async () => {
        const exitCode = await proc.exited;
        stdout = outBuf.s;
        stderr = errBuf.s;
        if (exitCode !== 0) {
          reject(new Error(`Lightpanda fetch failed (exit ${exitCode}): ${stderr}`));
        } else {
          resolve(stdout);
        }
      })
      .catch(reject);
  });
}
