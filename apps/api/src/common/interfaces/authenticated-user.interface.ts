export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  name: string;
}

export interface AccessTokenPayload {
  sub: string;
  username: string;
  jti: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}