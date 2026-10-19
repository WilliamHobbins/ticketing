import jwt, { JwtPayload } from "jsonwebtoken";
import { config } from "./config";

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
}

export function createAccessToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { email: user.email },
    config.JWT_SECRET,
    { subject: user.id, expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"], algorithm: "HS256" }
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
  if (typeof decoded === "string" || !decoded.sub || !decoded.email) {
    throw new Error("Token inválido");
  }
  return decoded as AccessTokenPayload;
}
