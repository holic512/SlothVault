import argon2 from 'argon2'

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id })
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password)
}
