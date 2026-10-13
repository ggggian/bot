import { describe, expect, test } from "bun:test";
import {
  CHALLENGE_NEEDS_AMOUNT_MESSAGE,
  CHALLENGE_PLAYERS,
  challengeForSomeoneElseMessage,
  resolveChallengeTarget,
} from "../src/utils/game-challenge";

const CREATOR = 4242n;
const reply = (replyToMessage: Record<string, unknown>) =>
  ({ reply_to_message: replyToMessage }) as any;

describe("resolveChallengeTarget", () => {
  test("a reply to a user with a username challenges them by @username", () => {
    expect(
      resolveChallengeTarget(
        reply({ from: { id: 5150, is_bot: false, first_name: "Rival", username: "rival" } }),
        CREATOR,
      ),
    ).toEqual({ telegramId: "5150", displayName: "@rival" });
  });

  test("a reply to a user without a username challenges them by full name", () => {
    expect(
      resolveChallengeTarget(
        reply({ from: { id: 6160, is_bot: false, first_name: "Ana", last_name: "Paz" } }),
        CREATOR,
      ),
    ).toEqual({ telegramId: "6160", displayName: "Ana Paz" });
  });

  test("a command that replies to nothing is not a challenge", () => {
    expect(resolveChallengeTarget({} as any, CREATOR)).toBeNull();
    expect(resolveChallengeTarget(undefined, CREATOR)).toBeNull();
  });

  test("a reply without a sender is not a challenge", () => {
    expect(resolveChallengeTarget(reply({ text: "synthetic" }), CREATOR)).toBeNull();
  });

  test("a reply to a bot is not a challenge", () => {
    expect(
      resolveChallengeTarget(
        reply({ from: { id: 7171, is_bot: true, first_name: "Bot" } }),
        CREATOR,
      ),
    ).toBeNull();
  });

  test("a reply to one's own message is not a challenge", () => {
    expect(
      resolveChallengeTarget(
        reply({ from: { id: Number(CREATOR), is_bot: false, first_name: "Me" } }),
        CREATOR,
      ),
    ).toBeNull();
  });

  test("the implicit reply to a forum topic's opening message is not a challenge", () => {
    expect(
      resolveChallengeTarget(
        reply({
          from: { id: 8181, is_bot: false, first_name: "Topic Owner" },
          forum_topic_created: { name: "synthetic-topic", icon_color: 7322096 },
        }),
        CREATOR,
      ),
    ).toBeNull();
  });

  test("a reply to a channel post or anonymous admin is not a challenge", () => {
    expect(
      resolveChallengeTarget(
        reply({
          from: { id: 777000, is_bot: false, first_name: "Telegram" },
          sender_chat: { id: -1009191, type: "channel", title: "synthetic-channel" },
        }),
        CREATOR,
      ),
    ).toBeNull();
  });
});

describe("challenge texts", () => {
  test("someone else tapping Accept is told who the challenge is for", () => {
    expect(challengeForSomeoneElseMessage({ telegramId: "5150", displayName: "Ana Paz" })).toBe(
      "This challenge is for Ana Paz.",
    );
  });

  test("a challenge is one on one and the menu reply asks for an amount", () => {
    expect(CHALLENGE_PLAYERS).toBe(2);
    expect(CHALLENGE_NEEDS_AMOUNT_MESSAGE).toBe(
      "To challenge someone, reply to their message with <code>/cf &lt;amount&gt; [TOKEN]</code>.",
    );
  });
});
