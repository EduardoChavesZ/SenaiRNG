export function normalizeDatabaseConnectionString(
  connectionString: string,
  enforceSsl = process.env.VERCEL === '1'
): string {
  const url = new URL(connectionString);
  let sslMode = url.searchParams.get('sslmode');

  if (sslMode === 'disable') {
    throw new Error('DATABASE_URL must use SSL.');
  }

  if (sslMode === 'allow' || sslMode === 'prefer' || (!sslMode && enforceSsl)) {
    url.searchParams.set('sslmode', 'require');
    sslMode = 'require';
  }

  if (sslMode) {
    url.searchParams.set('uselibpqcompat', 'true');
  }

  return url.toString();
}
