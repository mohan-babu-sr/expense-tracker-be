import mongoose from 'mongoose';

/**
 * Connects to MongoDB Atlas. Logs the host + database name only — never the URI,
 * because it contains the password (NFR4).
 */
export async function connectDb(uri: string): Promise<void> {
  mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => console.log('MongoDB reconnected'));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });

  const { host, name } = mongoose.connection;
  console.log(`MongoDB connected (host: ${host}, db: ${name})`);
  if (name === 'test') {
    console.warn('⚠️  Using database "test" — add /expense_tracker before the "?" in MONGODB_URI');
  }
}
