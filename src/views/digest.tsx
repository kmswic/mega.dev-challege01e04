import type { NightDigest } from '../digest/types.js';

export function DigestView({ night, digest }: { night: string; digest: NightDigest | null }) {
  return (
    <>
      <h1>digest · {night}</h1>
      {digest === null ? (
        <p>No run log found for {night}.</p>
      ) : (
        <>
          {digest.badLines > 0 && <p class="warn">bad lines: {digest.badLines}</p>}
          {digest.rows.length === 0 ? (
            <p class="mute">nothing ran</p>
          ) : (
            <table>
              <caption>Jobs for {digest.night}</caption>
              <thead>
                <tr>
                  <th scope="col">job</th>
                  <th scope="col">owner</th>
                  <th scope="col">runs</th>
                  <th scope="col">retries</th>
                  <th scope="col">last status</th>
                  <th scope="col">last error</th>
                  <th scope="col">first at</th>
                  <th scope="col">last at</th>
                </tr>
              </thead>
              <tbody>
                {digest.rows.map((row) => (
                  <tr data-job={row.job}>
                    <th scope="row">{row.job}</th>
                    <td>{row.owner ?? '—'}</td>
                    <td>{row.runs}</td>
                    <td>{row.retries >= 3 ? <strong class="warn">{row.retries} (high retries)</strong> : row.retries}</td>
                    <td>{row.lastStatus === 'fail' ? <strong class="warn">fail</strong> : row.lastStatus}</td>
                    <td>{row.lastError ?? '—'}</td>
                    <td><time dateTime={row.firstAt}>{row.firstAt}</time></td>
                    <td><time dateTime={row.lastAt}>{row.lastAt}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
