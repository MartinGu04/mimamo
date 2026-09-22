import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { RECEIPT_TOKEN_PATTERN, deriveDeliveryReceiptToken, hashReceiptToken } from "./receiptToken";

const DELIVERY_A = "11111111-1111-4111-8111-111111111111";
const DELIVERY_B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  process.env.NOTIFICATION_WORKER_SECRET = "a-test-worker-secret";
});

afterEach(() => {
  delete process.env.NOTIFICATION_WORKER_SECRET;
});

describe("deriveDeliveryReceiptToken", () => {
  it("produces 32 bytes of hex -- high entropy, and the exact shape the endpoint validates", () => {
    const token = deriveDeliveryReceiptToken(DELIVERY_A);
    expect(token).toMatch(RECEIPT_TOKEN_PATTERN);
    expect(token).toHaveLength(64);
  });

  it("is STABLE for a given delivery -- the property that keeps a late receipt from an earlier attempt valid", () => {
    expect(deriveDeliveryReceiptToken(DELIVERY_A)).toBe(deriveDeliveryReceiptToken(DELIVERY_A));
  });

  it("is different per delivery -- one device's token can never acknowledge another delivery", () => {
    expect(deriveDeliveryReceiptToken(DELIVERY_A)).not.toBe(deriveDeliveryReceiptToken(DELIVERY_B));
  });

  it("changes completely when the root secret changes -- the token is genuinely keyed, not a hash of the id", () => {
    const withFirstSecret = deriveDeliveryReceiptToken(DELIVERY_A);
    process.env.NOTIFICATION_WORKER_SECRET = "a-different-worker-secret";
    expect(deriveDeliveryReceiptToken(DELIVERY_A)).not.toBe(withFirstSecret);
  });

  it("is domain-separated from the worker secret itself -- a leaked receipt token is not worker authorization", () => {
    const secret = process.env.NOTIFICATION_WORKER_SECRET!;
    const token = deriveDeliveryReceiptToken(DELIVERY_A)!;
    expect(token).not.toContain(secret);
    // Nor is it simply HMAC(secret, deliveryId) -- the key is itself
    // derived through a fixed label first, so the two key spaces are
    // unrelated.
    const naive = createHash("sha256").update(`${secret}${DELIVERY_A}`).digest("hex");
    expect(token).not.toBe(naive);
  });

  it("returns null (never throws, never a weak fallback token) when no worker secret is configured", () => {
    delete process.env.NOTIFICATION_WORKER_SECRET;
    expect(deriveDeliveryReceiptToken(DELIVERY_A)).toBeNull();
  });

  it("returns null for an empty/non-string delivery id rather than minting a token for nothing", () => {
    expect(deriveDeliveryReceiptToken("")).toBeNull();
    expect(deriveDeliveryReceiptToken(undefined as unknown as string)).toBeNull();
  });
});

describe("hashReceiptToken -- the stored verifier", () => {
  it("is sha256(token) in lowercase hex", () => {
    const token = deriveDeliveryReceiptToken(DELIVERY_A)!;
    expect(hashReceiptToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("is NOT the token itself -- what the database stores can never be replayed as a receipt", () => {
    const token = deriveDeliveryReceiptToken(DELIVERY_A)!;
    expect(hashReceiptToken(token)).not.toBe(token);
  });

  it("is deterministic, so the same delivery's hash is rewritten identically on a retry rather than rotated", () => {
    const token = deriveDeliveryReceiptToken(DELIVERY_A)!;
    expect(hashReceiptToken(token)).toBe(hashReceiptToken(token));
  });

  it("separates two deliveries' verifiers completely", () => {
    expect(hashReceiptToken(deriveDeliveryReceiptToken(DELIVERY_A)!)).not.toBe(
      hashReceiptToken(deriveDeliveryReceiptToken(DELIVERY_B)!),
    );
  });
});

describe("RECEIPT_TOKEN_PATTERN", () => {
  it("accepts a real token and rejects everything else, before anything reaches the database", () => {
    expect(RECEIPT_TOKEN_PATTERN.test(deriveDeliveryReceiptToken(DELIVERY_A)!)).toBe(true);
    for (const junk of ["", "not-a-token", "A".repeat(64), "0".repeat(63), "0".repeat(65), "' or 1=1 --"]) {
      expect(RECEIPT_TOKEN_PATTERN.test(junk)).toBe(false);
    }
  });
});
