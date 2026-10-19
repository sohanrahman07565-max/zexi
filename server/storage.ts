export * from '../netlify/functions/lib/storage';
import { sharedStorage } from '../netlify/functions/lib/storage';
export const storage = sharedStorage;
