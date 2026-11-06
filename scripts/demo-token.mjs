// Prints a demo HS256 token. Usage: node scripts/demo-token.mjs [scope]
import { SignJWT } from "jose";

const secret = process.env.JWT_SECRET ?? "demo-secret-change-me-demo-secret-change-me";
const token = await new SignJWT({ scope: process.argv[2] ?? "policies:read" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("demo-user")
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(secret));
console.log(token);
