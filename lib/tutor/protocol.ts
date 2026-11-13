export const MAX_TUTOR_TEXT = 4000;
export const MAX_TUTOR_HISTORY = 10;
export const MAX_TUTOR_PHOTO = 1_400_000;

export type TutorTurn = { role: 'user' | 'assistant'; content: string };
export type TutorSource = {
  title: string;
  href: string;
  kind: 'material' | 'web';
  excerpt?: string;
  number?: number;
};
export type TutorError = 'invalid' | 'image' | 'model' | 'auth' | 'timeout' | 'unavailable';
export type TutorEvent =
  | { type: 'status'; status: 'searching' | 'answering' }
  | { type: 'text'; delta: string }
  | { type: 'problem'; problem: string }
  | { type: 'sources'; sources: TutorSource[] }
  | { type: 'notice'; code: 'material_missing' | 'web_unavailable' }
  | { type: 'error'; code: TutorError }
  | { type: 'done' };
