import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.');
export function passwordChecks(value: string) {
  const length = Array.from(value).length;
  return { length: length >= 9 && length <= 128, uppercase: /\p{Lu}/u.test(value), lowercase: /\p{Ll}/u.test(value), special: /[\p{P}\p{S}]/u.test(value) };
}
export function passwordProblem(value: string): string | null {
  const length = Array.from(value).length;
  const checks = passwordChecks(value);
  if (length < 9) return 'Use at least 9 characters.';
  if (length > 128) return 'Use no more than 128 characters.';
  if (!checks.uppercase) return 'Include an uppercase letter.';
  if (!checks.lowercase) return 'Include a lowercase letter.';
  if (!checks.special) return 'Include a special character, such as ! or @.';
  return null;
}
export const passwordSchema = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});
export const signupSchema = z.object({ name: z.string().trim().min(2, 'Enter at least 2 characters.').max(100), email: emailSchema, password: passwordSchema }).strict();
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password.').refine(value => Array.from(value).length <= 128, 'Use no more than 128 characters.') }).strict();
export const resetRequestSchema = z.object({ email: emailSchema }).strict();
export const resetSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/, 'This reset link is invalid.'), password: passwordSchema }).strict();
export const staffSchema = signupSchema;
