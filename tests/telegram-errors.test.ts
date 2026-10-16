import { describe, expect, test } from "bun:test";
import {
  getErrorDescription,
  getRetryAfterSeconds,
  isBotNotAdmin,
  isChatInaccessible,
  isDuplicateContent,
  isEditProhibited,
  isBotInitiationForbidden,
  isMessageMissing,
  isMessageNotModified,
  isMissingEditableContent,
  isRateLimited,
  isRequestRefused,
  shouldFallbackToReply,
} from "../src/utils/telegram-errors";

describe("telegram error helpers", () => {
  test("isBotNotAdmin matches only Telegram's missing admin rights refusal", () => {
    expect(
      isBotNotAdmin(new Error("Call to 'sendMessage' failed! (400: Bad Request: BOT_NOT_ADMIN)")),
    ).toBe(true);
    expect(isBotNotAdmin({ description: "Bad Request: bot_not_admin" })).toBe(true);
    expect(isBotNotAdmin(new Error("Bad Request: not enough rights to send text messages"))).toBe(
      false,
    );
    expect(isBotNotAdmin(undefined)).toBe(false);
  });

  test("isRequestRefused matches only requests Telegram answered with a refusal", () => {
    expect(isRequestRefused({ error_code: 400, description: "Bad Request: BOT_NOT_ADMIN" })).toBe(
      true,
    );
    expect(isRequestRefused({ error_code: 403, description: "Forbidden: bot was kicked" })).toBe(
      true,
    );
    expect(isRequestRefused({ error_code: 429, description: "Too Many Requests" })).toBe(false);
    expect(isRequestRefused({ error_code: 502, description: "Bad Gateway" })).toBe(false);
    expect(isRequestRefused(new Error("Network request for 'sendMessage' failed!"))).toBe(false);
    expect(isRequestRefused(undefined)).toBe(false);
  });

  test("getErrorDescription extracts string and object messages", () => {
    expect(getErrorDescription("simple error")).toBe("simple error");
    expect(getErrorDescription({ message: "From message" })).toBe("From message");
    expect(getErrorDescription({ description: "From description" })).toBe("From description");
    expect(getErrorDescription(42)).toBe("");
  });

  test("message predicates are case-insensitive", () => {
    expect(isMessageNotModified("MESSAGE IS NOT MODIFIED")).toBe(true);
    expect(isMessageMissing({ description: "Message to edit not found" })).toBe(true);
    expect(isEditProhibited("Message CAN'T be edited")).toBe(true);
    expect(isChatInaccessible({ message: "Bot was blocked by the user" })).toBe(true);
    expect(isMissingEditableContent("There is no caption in the message to edit")).toBe(true);
    expect(isDuplicateContent("Message with the same content already exists")).toBe(true);
  });

  test("predicates return false for unrelated errors", () => {
    const unrelated = "some other error";
    expect(isMessageNotModified(unrelated)).toBe(false);
    expect(isMessageMissing(unrelated)).toBe(false);
    expect(isEditProhibited(unrelated)).toBe(false);
    expect(isChatInaccessible(unrelated)).toBe(false);
    expect(isMissingEditableContent(unrelated)).toBe(false);
    expect(isDuplicateContent(unrelated)).toBe(false);
    expect(isBotInitiationForbidden(unrelated)).toBe(false);
  });

  test("predicates return false when the error carries no description", () => {
    for (const empty of [null, undefined, "", {}, { description: 404 }]) {
      expect(isMessageNotModified(empty)).toBe(false);
      expect(isMessageMissing(empty)).toBe(false);
      expect(isDuplicateContent(empty)).toBe(false);
      expect(shouldFallbackToReply(empty)).toBe(false);
    }
  });

  test("shouldFallbackToReply aggregates individual predicates", () => {
    expect(shouldFallbackToReply("Message to delete not found")).toBe(true);
    expect(shouldFallbackToReply("some other error")).toBe(false);
  });

  test("isBotInitiationForbidden detects 403 initiation errors", () => {
    expect(
      isBotInitiationForbidden({
        error_code: 403,
        description: "Forbidden: bot can't initiate conversation with a user",
      }),
    ).toBe(true);
    expect(
      isBotInitiationForbidden({
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
    ).toBe(true);
  });

  test("isRateLimited detects 429 and retry-after messages", () => {
    expect(isRateLimited({ error_code: 429, description: "Too Many Requests" })).toBe(true);
    expect(isRateLimited({ description: "Too Many Requests: retry after 3" })).toBe(true);
    expect(isRateLimited("retry after 1")).toBe(true);
    expect(isRateLimited("not a rate limit")).toBe(false);
  });

  test("getRetryAfterSeconds reads retry_after from Telegram error objects and descriptions", () => {
    expect(getRetryAfterSeconds({ error_code: 429, parameters: { retry_after: 7 } })).toBe(7);
    expect(getRetryAfterSeconds({ retry_after: 2 })).toBe(2);
    expect(getRetryAfterSeconds({ description: "Too Many Requests: retry after 4" })).toBe(4);
    expect(getRetryAfterSeconds({ description: "Too Many Requests: Retry After 0" })).toBe(0);
    expect(getRetryAfterSeconds({ description: "Too Many Requests" })).toBeNull();
    expect(getRetryAfterSeconds("retry after 9")).toBeNull();
  });
});
