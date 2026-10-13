import type { Message } from "grammy/types";
import type { GameChallenge } from "./game-database";
import { getTelegramUserDisplayName } from "./telegram-display";

/** A challenge is one on one, whatever player count the command asked for. */
export const CHALLENGE_PLAYERS = 2;

/**
 * A coinflip sent as a reply to someone's message challenges that person.
 * Replies to bots, channels, anonymous admins or one's own message are not challenges.
 */
export const resolveChallengeTarget = (
  message: Pick<Message, "reply_to_message"> | undefined,
  creatorTelegramId: bigint,
): GameChallenge | null => {
  const replied = message?.reply_to_message;
  // In forum topics every message replies to the topic's opening service message.
  if (!replied?.from || replied.forum_topic_created || replied.sender_chat) return null;
  if (replied.from.is_bot || BigInt(replied.from.id) === creatorTelegramId) return null;
  return {
    telegramId: String(replied.from.id),
    displayName: getTelegramUserDisplayName(replied.from, "Player"),
  };
};

/** Plain text: callback answers do not render HTML. */
export const challengeForSomeoneElseMessage = (challenge: GameChallenge): string =>
  `This challenge is for ${challenge.displayName}.`;

export const CHALLENGE_NEEDS_AMOUNT_MESSAGE =
  "To challenge someone, reply to their message with <code>/cf &lt;amount&gt; [TOKEN]</code>.";

export const CHALLENGE_SAME_CHAT_MESSAGE =
  "To challenge someone, reply to their message in this chat and topic.";

export const CHALLENGE_JOIN_LABEL = "⚔️ Accept";
