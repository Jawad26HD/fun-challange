import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { sessionStorage } from './session-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const universityDomain = (process.env.EXPO_PUBLIC_UNIVERSITY_EMAIL_DOMAIN || '').trim().toLowerCase();
export const configured = Boolean(url && key && universityDomain);
export const supabase = url && key ? createClient(url, key, {
  auth: { storage: sessionStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web', flowType: 'pkce' },
}) : null;
