import { supabase } from './supabase';
import { AppUser } from '../contexts/AuthContext';

export const BULK_DELETE_CONFIRM_WORD = 'Delete';

export function requiresPasswordReauth(user: AppUser | null): boolean {
  if (!user) return false;
  // In Supabase, if they logged in with Google we might not have a password,
  // but for simplicity we'll just return true and let signInWithPassword fail or succeed.
  return true;
}

export async function reauthenticateForSensitiveAction(user: AppUser, password: string): Promise<void> {
  if (!user.email) throw new Error('No email is linked to this account.');
  
  // Re-authenticate by signing in again
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: password
  });
  
  if (error) {
    throw new Error('Incorrect password or authentication failed.');
  }
}

