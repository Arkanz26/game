import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Minimum policy for local accounts. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 12) return "Kata sandi minimal 12 karakter";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Kata sandi harus memuat huruf besar, huruf kecil, dan angka";
  }
  return null;
}
