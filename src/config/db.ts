import mongoose from 'mongoose';

/**
 * Connects to MongoDB Atlas. Logs the host + database name only — never the URI,
 * because it contains the password (NFR4).
 *
 * @param dbName optional override of the database in the URI (MONGODB_DB_NAME) — keeps dev off the live DB.
 * @param isProduction used only for the "dev server on live database" warning.
 */
export async function connectDb(uri: string, dbName: string | undefined, isProduction: boolean): Promise<void> {
  mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => console.log('MongoDB reconnected'));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, ...(dbName ? { dbName } : {}) });

  const { host, name } = mongoose.connection;
  console.log(`MongoDB connected (host: ${host}, db: ${name})`);
  if (name === 'test') {
    console.warn('⚠️  Using database "test" — add /expense_tracker before the "?" in MONGODB_URI');
  }
  if (!isProduction && !name.endsWith('_dev')) {
    console.warn(
      `⚠️  Development server is using "${name}" — probably the LIVE database. ` +
        'Set MONGODB_DB_NAME=expense_tracker_dev in server/.env unless you really mean it.',
    );
  }
}
