import assert from "node:assert/strict";
import test from "node:test";
import { authenticationMethodsFromVerifiedJwt } from "../functions/_shared/authentication-methods.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const base64Url = (value) => Buffer.from(JSON.stringify(value), "utf8")
  .toString("base64url");

const verifiedFixture = (payload) => `${base64Url({ alg: "ES256", typ: "JWT" })}.${base64Url(payload)}.fixture-signature`;

test("a verified OAuth session exposes only its structured AMR methods", () => {
  const methods = authenticationMethodsFromVerifiedJwt(verifiedFixture({
    sub: USER_ID,
    amr: [
      { method: "oauth", timestamp: 1 },
      { method: "totp", timestamp: 2 },
      { method: "OAuth", timestamp: 3 },
      "oauth",
      null,
    ],
  }), USER_ID);
  assert.deepEqual([...methods].sort(), ["oauth", "totp"]);
});

test("an OTP-only session never satisfies the OAuth staff boundary", () => {
  const methods = authenticationMethodsFromVerifiedJwt(verifiedFixture({
    sub: USER_ID,
    amr: [{ method: "otp", timestamp: 1 }],
  }), USER_ID);
  assert.equal(methods.has("oauth"), false);
  assert.equal(methods.has("otp"), true);
});

test("missing AMR fails closed for staff without invalidating a verified learner identity", () => {
  const methods = authenticationMethodsFromVerifiedJwt(verifiedFixture({ sub: USER_ID }), USER_ID);
  assert.equal(methods.size, 0);
});

test("the verified token subject must match the Auth user", () => {
  assert.throws(() => authenticationMethodsFromVerifiedJwt(verifiedFixture({
    sub: "22222222-2222-4222-8222-222222222222",
    amr: [{ method: "oauth" }],
  }), USER_ID), /authentication_required/u);
});

test("malformed JWT payloads are rejected", () => {
  assert.throws(
    () => authenticationMethodsFromVerifiedJwt("header.not_base64!.signature", USER_ID),
    /authentication_required/u,
  );
  assert.throws(
    () => authenticationMethodsFromVerifiedJwt("two.segments", USER_ID),
    /authentication_required/u,
  );
});
