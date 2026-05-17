import * as bcrypt from 'bcryptjs';

export async function hash(password: string, saltRounds: number = 10): Promise<string> {
  return bcrypt.hash(password, saltRounds);
}

export async function compare(password: string, storedHash: string): Promise<boolean> {
  try {
    return bcrypt.compare(password, storedHash);
  } catch (error) {
    console.error('Password comparison error:', error);
    return false;
  }
}